use serde::Serialize;
use sysinfo::System;

const MIB: u64 = 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryInfo {
    total_mb: u64,
    available_mb: u64,
    recommended_mb: Option<u32>,
}

fn recommendation(total_mb: u64, available_mb: u64) -> Option<u32> {
    if total_mb == 0 || available_mb < 1024 {
        return None;
    }
    let limit = (total_mb / 4).min(available_mb / 2).min(8192);
    Some(((limit / 256) * 256).clamp(512, 8192) as u32)
}

#[tauri::command]
pub fn memory_info() -> Result<MemoryInfo, String> {
    let mut system = System::new();
    system.refresh_memory();
    let total_mb = system.total_memory() / MIB;
    let available_mb = system.available_memory() / MIB;
    if total_mb == 0 {
        return Err("无法获取设备内存信息".into());
    }
    Ok(MemoryInfo {
        total_mb,
        available_mb,
        recommended_mb: recommendation(total_mb, available_mb),
    })
}

pub fn launch_memory(mode: &str, manual_mb: u32) -> Result<u32, String> {
    match mode {
        "" | "manual" if (512..=32768).contains(&manual_mb) => Ok(manual_mb),
        "" | "manual" => Err("内存须在 512–32768 MB 之间".into()),
        "auto" => memory_info()?.recommended_mb.ok_or_else(|| {
            "当前可用内存不足 1024 MB，无法自动分配内存；请关闭其他程序或手动设置。".into()
        }),
        _ => Err("未知内存分配模式".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recommendation_respects_total_available_and_limits() {
        assert_eq!(recommendation(0, 4096), None);
        assert_eq!(recommendation(8192, 800), None);
        assert_eq!(recommendation(2048, 1500), Some(512));
        assert_eq!(recommendation(8192, 6144), Some(2048));
        assert_eq!(recommendation(16384, 2048), Some(1024));
        assert_eq!(recommendation(65536, 50000), Some(8192));
    }

    #[test]
    fn manual_mode_validates_without_querying_system_memory() {
        assert_eq!(launch_memory("manual", 4096).unwrap(), 4096);
        assert_eq!(launch_memory("", 512).unwrap(), 512);
        assert!(launch_memory("manual", 511).is_err());
        assert!(launch_memory("manual", 32769).is_err());
        assert!(launch_memory("other", 4096).is_err());
    }
}
