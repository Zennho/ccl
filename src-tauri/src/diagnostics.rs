use serde::Serialize;
use std::{
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

const MAX_LOG_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnosis {
    pub category: &'static str,
    pub title: &'static str,
    pub steps: Vec<&'static str>,
    pub source: &'static str,
}

fn tail(path: &Path) -> std::io::Result<String> {
    let mut file = File::open(path)?;
    let length = file.metadata()?.len();
    file.seek(SeekFrom::Start(length.saturating_sub(MAX_LOG_BYTES)))?;
    let mut data = Vec::new();
    file.take(MAX_LOG_BYTES).read_to_end(&mut data)?;
    Ok(String::from_utf8_lossy(&data).into_owned())
}

// Only follow an explicitly referenced, recently written report inside this
// instance's crash-reports directory. Never accept arbitrary paths from a log.
fn related_report(log: &str, runtime: &Path, started: SystemTime) -> Option<PathBuf> {
    let runtime = fs::canonicalize(runtime).ok()?;
    let report_dir = fs::canonicalize(runtime.join("crash-reports")).ok()?;
    if report_dir.parent() != Some(runtime.as_path()) {
        return None;
    }
    for line in log.lines().rev() {
        let lower = line.to_ascii_lowercase();
        let Some((offset, length)) = ["crash report saved to:", "crash report has been saved to:"]
            .iter()
            .find_map(|pattern| lower.find(pattern).map(|at| (at, pattern.len())))
        else {
            continue;
        };
        let name = line[offset + length..]
            .trim()
            .trim_start_matches("#@!@#")
            .trim()
            .trim_matches(['\'', '"']);
        if name.is_empty() || name.len() > 4096 {
            continue;
        }
        let path = Path::new(name);
        let path = if path.is_absolute() {
            path.to_path_buf()
        } else {
            runtime.join(path)
        };
        let Ok(path) = fs::canonicalize(path) else {
            continue;
        };
        if path.parent() != Some(report_dir.as_path())
            || path.extension().and_then(|e| e.to_str()) != Some("txt")
        {
            continue;
        }
        let Ok(meta) = fs::metadata(&path) else {
            continue;
        };
        if !meta.is_file()
            || meta
                .modified()
                .ok()
                .and_then(|t| t.checked_add(Duration::from_secs(5)))
                .is_none_or(|t| t < started)
        {
            continue;
        }
        return Some(path);
    }
    None
}

fn classify(text: &str, source: &'static str) -> Diagnosis {
    let log = text.to_ascii_lowercase();
    let contains = |patterns: &[&str]| patterns.iter().any(|p| log.contains(p));
    let (category, title, steps) = if contains(&[
        "unsupportedclassversionerror",
        "has been compiled by a more recent version of the java runtime",
        "requires a more recent version of java",
        "requires java 21 or later",
        "requires java 17 or later",
        "requires java 8 or later",
        "requires java 25 or later",
    ]) {
        (
            "java_version",
            "Java 版本可能不匹配",
            vec![
                "在 Java 管理中安装该游戏版本和模组要求的 Java。",
                "在启动设置中选择对应的 Java 路径后重试。",
            ],
        )
    } else if contains(&[
        "java.lang.outofmemoryerror",
        "could not reserve enough space for object heap",
        "there is insufficient memory for the java runtime environment",
        "native memory allocation (malloc) failed",
        "failed to allocate memory",
    ]) {
        (
            "memory",
            "内存可能不足",
            vec![
                "在启动设置中检查最大内存；可尝试自动分配，并关闭占用内存较多的程序。",
                "若使用大量模组或高分辨率资源包，请适当调整内存，并确认系统仍有可用内存。",
            ],
        )
    } else if contains(&[
        "unrecognized vm option",
        "improperly specified vm option",
        "invalid maximum heap size",
        "invalid initial heap size",
    ]) {
        (
            "jvm_arguments",
            "Java 启动参数可能无效",
            vec![
                "在启动设置中检查或暂时清空自定义 JVM 参数。",
                "确认内存参数和所选 Java 版本匹配后重新启动。",
            ],
        )
    } else if contains(&[
        "modresolutionexception",
        "incompatible mods found!",
        "missing or unsupported mandatory dependencies",
        "missing mandatory dependencies",
        "mod loading has failed",
        "modloadingexception",
        "mixin transformer error",
        "mixin apply failed",
        "failed to apply mixin",
    ]) {
        (
            "mods",
            "模组或其依赖可能不兼容",
            vec![
                "检查近期安装或更新的模组是否支持当前游戏版本和加载器。",
                "检查是否缺少必需依赖；可先停用近期添加的模组，逐步定位问题。",
            ],
        )
    } else if contains(&[
        "java.nio.file.filesystemexception: no space left on device",
        "no space left on device",
        "there is not enough space on the disk",
        "there is insufficient space on the disk",
    ]) {
        (
            "disk_space",
            "磁盘可用空间可能不足",
            vec![
                "检查游戏目录和系统临时目录所在磁盘的可用空间。",
                "释放足够空间后重试；清理前请保留存档和模组。",
            ],
        )
    } else if contains(&[
        "java.nio.file.accessdeniedexception:",
        "java.io.filenotfoundexception: access is denied",
        "permission denied: unable to open file",
    ]) {
        (
            "file_access",
            "游戏文件可能无法访问",
            vec![
                "检查游戏目录是否可写，以及安全软件是否拦截了相关文件。",
                "关闭占用文件的程序后重试；必要时查看日志中的具体路径。",
            ],
        )
    } else if contains(&[
        "java.lang.unsatisfiedlinkerror",
        "wrong elf class",
        "wrong architecture",
        "can't load amd 64-bit .dll on a ia 32-bit platform",
    ]) {
        (
            "native_library",
            "Java 或原生库可能与系统架构不匹配",
            vec![
                "确认所选 Java 与操作系统架构匹配，并检查该版本的原生库是否完整。",
                "若近期更换了 Java 或图形模组，可恢复原设置后重试。",
            ],
        )
    } else if contains(&[
        "glfw error 65542",
        "glfw error 65543",
        "glfw error 65544",
        "failed to create opengl context",
        "failed to create window",
        "pixel format not accelerated",
        "does not support opengl",
    ]) {
        (
            "graphics",
            "图形环境可能不兼容",
            vec![
                "检查显卡驱动和系统图形加速是否正常，并更新显卡驱动。",
                "若启用了光影或图形模组，可暂时关闭后重试。",
            ],
        )
    } else if contains(&[
        "could not find or load main class net.minecraft",
        "could not find or load main class net.fabricmc",
        "could not find or load main class cpw.mods",
    ]) {
        (
            "missing_game_files",
            "游戏文件或加载器依赖可能缺失",
            vec![
                "检查该版本的游戏文件和加载器是否完整，必要时重新安装对应版本。",
                "操作前保留存档、模组和配置，避免直接删除整个游戏目录。",
            ],
        )
    } else if contains(&[
        "invalid or corrupt jarfile",
        "zip end header not found",
        "error in opening zip file",
        "zip file is empty",
    ]) {
        (
            "corrupt_file",
            "游戏或模组文件可能损坏",
            vec![
                "检查日志中提到的文件，并重新下载对应的游戏文件或模组。",
                "重新下载前保留存档和配置，避免直接删除整个游戏目录。",
            ],
        )
    } else {
        (
            "unknown",
            "暂未识别出明确原因",
            vec![
                "打开启动日志，查看退出前的异常信息和错误提示。",
                "检查 Java、模组及其依赖是否与当前游戏版本兼容；近期有改动时可逐项排查。",
            ],
        )
    };
    Diagnosis {
        category,
        title,
        steps,
        source,
    }
}

pub fn diagnose(log_path: &Path, runtime: &Path, started: SystemTime) -> Diagnosis {
    let Ok(log) = tail(log_path) else {
        return Diagnosis {
            category: "unavailable",
            title: "无法读取启动日志",
            steps: vec!["尝试打开启动日志，检查文件是否存在及是否有读取权限。"],
            source: "日志不可用",
        };
    };
    let report = related_report(&log, runtime, started).and_then(|path| tail(&path).ok());
    if let Some(report) = report {
        classify(&format!("{log}\n{report}"), "启动日志与关联崩溃报告")
    } else {
        classify(&log, "启动日志末尾")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn identifies_common_failures_without_exposing_log_text() {
        for (line, category) in [
            (
                "java.lang.UnsupportedClassVersionError: class file version 65.0",
                "java_version",
            ),
            ("java.lang.OutOfMemoryError: Java heap space", "memory"),
            ("Unrecognized VM option '-XX:bad'", "jvm_arguments"),
            (
                "net.fabricmc.loader.impl.FormattedException: Incompatible mods found!",
                "mods",
            ),
            (
                "GLFW error 65542: WGL: The driver does not appear to support OpenGL",
                "graphics",
            ),
            (
                "Error: Could not find or load main class net.minecraft.client.main.Main",
                "missing_game_files",
            ),
            (
                "java.util.zip.ZipException: zip END header not found",
                "corrupt_file",
            ),
            ("java.io.IOException: No space left on device", "disk_space"),
            (
                "java.nio.file.AccessDeniedException: /private/file",
                "file_access",
            ),
            (
                "java.lang.UnsatisfiedLinkError: wrong ELF class",
                "native_library",
            ),
            ("disk space: 10 GB", "unknown"),
            ("Game exited with code 1", "unknown"),
            (
                "[INFO] Java 21 installed, Iris enabled, memory 4 GB",
                "unknown",
            ),
        ] {
            let result = classify(line, "test");
            assert_eq!(result.category, category, "{line}");
            assert!(!format!("{} {:?}", result.title, result.steps).contains("class file version"));
        }
    }
    #[test]
    fn reads_bounded_tail_and_only_a_matching_recent_report() {
        use std::io::Write;
        let dir = std::env::temp_dir().join(format!("ccl-diagnose-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("crash-reports")).unwrap();
        let start = SystemTime::now();
        let report = dir.join("crash-reports/crash-test.txt");
        fs::write(&report, "java.lang.OutOfMemoryError: Java heap space").unwrap();
        let log = dir.join("launch.log");
        let mut file = File::create(&log).unwrap();
        file.write_all(&vec![b'x'; MAX_LOG_BYTES as usize + 1024])
            .unwrap();
        writeln!(file, "\nCrash report saved to: {}", report.display()).unwrap();
        drop(file);
        let result = diagnose(&log, &dir, start);
        assert_eq!(result.category, "memory");
        assert_eq!(result.source, "启动日志与关联崩溃报告");
        assert_eq!(
            diagnose(&log, &dir, start + Duration::from_secs(3600)).category,
            "unknown"
        );
        let outside = dir.join("outside.txt");
        fs::write(&outside, "java.lang.OutOfMemoryError").unwrap();
        fs::write(
            &log,
            format!("Crash report saved to: {}", outside.display()),
        )
        .unwrap();
        assert_eq!(diagnose(&log, &dir, start).category, "unknown");
        #[cfg(unix)]
        {
            let link = dir.join("crash-reports/link.txt");
            std::os::unix::fs::symlink(&outside, &link).unwrap();
            fs::write(&log, format!("Crash report saved to: {}", link.display())).unwrap();
            assert_eq!(diagnose(&log, &dir, start).category, "unknown");
        }
        assert_eq!(
            diagnose(&dir.join("missing"), &dir, start).category,
            "unavailable"
        );
        fs::remove_dir_all(dir).unwrap();
    }
}
