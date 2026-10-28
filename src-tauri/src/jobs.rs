use crate::ResultT;
use std::{
    collections::{HashMap, HashSet},
    future::Future,
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
};
use tokio::sync::watch;

pub const CANCELLED: &str = "任务已取消";
struct Job {
    cancel: watch::Sender<bool>,
    game_dir: Option<PathBuf>,
}
#[derive(Default)]
struct JobState {
    jobs: HashMap<String, Arc<Job>>,
    deleting: HashSet<PathBuf>,
}
static JOBS: OnceLock<Mutex<JobState>> = OnceLock::new();
fn jobs() -> &'static Mutex<JobState> {
    JOBS.get_or_init(|| Mutex::new(JobState::default()))
}
fn normalize_path(path: &str) -> PathBuf {
    let p = PathBuf::from(path);
    std::fs::canonicalize(&p).unwrap_or_else(|_| {
        if p.is_absolute() {
            p
        } else {
            std::env::current_dir().unwrap_or_default().join(p)
        }
    })
}
fn valid(id: &str) -> bool {
    !id.is_empty() && id.len() <= 100 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}
fn get(id: Option<&str>) -> ResultT<Option<Arc<Job>>> {
    let Some(id) = id else { return Ok(None) };
    if !valid(id) {
        return Err("任务标识无效".into());
    }
    jobs()
        .lock()
        .map_err(|_| "任务状态不可用")?
        .jobs
        .get(id)
        .cloned()
        .map(Some)
        .ok_or_else(|| "任务已经结束".into())
}
#[tauri::command]
pub fn begin_job(job_id: String, game_dir: Option<String>) -> ResultT<()> {
    if !valid(&job_id) {
        return Err("任务标识无效".into());
    }
    let mut all = jobs().lock().map_err(|_| "任务状态不可用")?;
    if all.jobs.contains_key(&job_id) {
        return Err("任务已经存在".into());
    }
    let game_dir = game_dir
        .filter(|d| !d.trim().is_empty())
        .map(|d| normalize_path(&d));
    if game_dir.as_ref().is_some_and(|d| all.deleting.contains(d)) {
        return Err("正在删除该游戏目录中的版本，请稍后重试".into());
    }
    let (cancel, _) = watch::channel(false);
    all.jobs.insert(job_id, Arc::new(Job { cancel, game_dir }));
    Ok(())
}
#[tauri::command]
pub fn cancel_job(job_id: String) -> ResultT<()> {
    if let Some(job) = get(Some(&job_id))? {
        job.cancel.send_replace(true);
    }
    Ok(())
}
#[tauri::command]
pub fn end_job(job_id: String) {
    if let Ok(mut all) = jobs().lock() {
        all.jobs.remove(&job_id);
    }
}
pub fn check(id: Option<&str>) -> ResultT<()> {
    if get(id)?.is_some_and(|j| *j.cancel.borrow()) {
        Err(CANCELLED.into())
    } else {
        Ok(())
    }
}
pub fn while_idle<T>(path: &str, action: impl FnOnce() -> ResultT<T>) -> ResultT<T> {
    let path = normalize_path(path);
    {
        let mut all = jobs().lock().map_err(|_| "任务状态不可用")?;
        if all.deleting.contains(&path)
            || all
                .jobs
                .values()
                .any(|j| j.game_dir.as_ref() == Some(&path))
        {
            return Err("该游戏目录中有正在运行的任务或删除操作，请稍后重试".into());
        }
        all.deleting.insert(path.clone());
    }
    struct Reservation(PathBuf);
    impl Drop for Reservation {
        fn drop(&mut self) {
            if let Ok(mut all) = jobs().lock() {
                all.deleting.remove(&self.0);
            }
        }
    }
    let _reservation = Reservation(path);
    action()
}
pub async fn race<T>(id: Option<&str>, future: impl Future<Output = ResultT<T>>) -> ResultT<T> {
    let Some(job) = get(id)? else {
        return future.await;
    };
    let mut rx = job.cancel.subscribe();
    if *rx.borrow() {
        return Err(CANCELLED.into());
    }
    tokio::pin!(future);
    tokio::select! {
        biased;
        result = &mut future => result,
        _ = rx.changed() => Err(CANCELLED.into()),
    }
}

pub struct CleanupPath {
    path: PathBuf,
    directory: bool,
}
impl CleanupPath {
    pub fn file(path: PathBuf) -> Self {
        Self {
            path,
            directory: false,
        }
    }
    pub fn dir(path: PathBuf) -> Self {
        Self {
            path,
            directory: true,
        }
    }
}
impl Drop for CleanupPath {
    fn drop(&mut self) {
        if self.directory {
            let _ = std::fs::remove_dir_all(&self.path);
        } else {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

pub fn copy_checked(
    reader: &mut impl std::io::Read,
    writer: &mut impl std::io::Write,
    job: Option<&str>,
) -> ResultT<()> {
    let mut buf = [0u8; 64 * 1024];
    loop {
        check(job)?;
        let n = reader.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            return Ok(());
        }
        writer.write_all(&buf[..n]).map_err(|e| e.to_string())?;
    }
}
pub struct CheckedReader<R> {
    pub inner: R,
    pub job: Option<String>,
}
impl<R: std::io::Read> std::io::Read for CheckedReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        check(self.job.as_deref()).map_err(std::io::Error::other)?;
        self.inner.read(buf)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    #[tokio::test]
    async fn cancellation_stops_future_and_keeps_other_jobs_running() {
        begin_job("test-cancel-a".into(), None).unwrap();
        begin_job("test-cancel-b".into(), None).unwrap();
        let dropped = Arc::new(AtomicBool::new(false));
        struct Mark(Arc<AtomicBool>);
        impl Drop for Mark {
            fn drop(&mut self) {
                self.0.store(true, Ordering::SeqCst)
            }
        }
        let flag = dropped.clone();
        let (started, ready) = tokio::sync::oneshot::channel();
        let worker = tokio::spawn(async move {
            race(Some("test-cancel-a"), async move {
                let _mark = Mark(flag);
                let _ = started.send(());
                std::future::pending::<ResultT<()>>().await
            })
            .await
        });
        ready.await.unwrap();
        cancel_job("test-cancel-a".into()).unwrap();
        assert_eq!(worker.await.unwrap().unwrap_err(), CANCELLED);
        assert!(dropped.load(Ordering::SeqCst));
        assert!(check(Some("test-cancel-b")).is_ok());
        end_job("test-cancel-a".into());
        end_job("test-cancel-b".into());
    }
    #[test]
    fn canceled_copy_stops_and_idle_guard_blocks_deletion() {
        begin_job("test-cancel-copy".into(), Some("/tmp/ccl-job-test".into())).unwrap();
        assert!(while_idle("/tmp/ccl-job-test", || Ok(())).is_err());
        cancel_job("test-cancel-copy".into()).unwrap();
        assert!(copy_checked(
            &mut std::io::Cursor::new(vec![1; 100]),
            &mut Vec::new(),
            Some("test-cancel-copy")
        )
        .is_err());
        end_job("test-cancel-copy".into());
        assert!(while_idle("/tmp/ccl-job-test", || Ok(())).is_ok());
    }
    #[test]
    fn deleting_one_directory_does_not_block_other_cancellation() {
        begin_job("unrelated-job".into(), Some("/tmp/other-game".into())).unwrap();
        while_idle("/tmp/deleting-game", || {
            assert!(begin_job("blocked-job".into(), Some("/tmp/deleting-game".into())).is_err());
            cancel_job("unrelated-job".into())?;
            Ok(())
        })
        .unwrap();
        assert!(check(Some("unrelated-job")).is_err());
        end_job("unrelated-job".into());
        begin_job("blocked-job".into(), Some("/tmp/deleting-game".into())).unwrap();
        end_job("blocked-job".into());
    }
}
