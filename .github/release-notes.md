Compass Craft Launcher（CCL）是支持 Windows、Linux 和 macOS 的 Minecraft Java 版启动器。

本次更新：

- 下载可靠性：带 SHA-1 校验的游戏文件保留未完成片段，重试或重启后可继续下载，完成后校验文件。资源包等其他下载仍在任务结束时清理未完成片段。
- 账户与头像：支持保存和切换多个微软正版账户，刷新令牌保存在系统凭据库；右上角头像显示当前账户皮肤或离线预览皮肤。
- 离线皮肤：可为选定实例同步本地皮肤；游戏内显示需要安装兼容版本的 CustomSkinLoader，其他玩家默认看不到本地皮肤，组件的皮肤源设置可能影响显示。
- 实例启动设置：可按实例独立保存 Java 路径、内存、G1GC 和启动参数，也可恢复使用全局设置。
- 崩溃诊断：增加磁盘空间、文件访问和原生库架构问题的识别和排查建议。

Windows x64 下载 `.exe` 安装程序；Linux x64 下载 `.deb` 或 `.AppImage`；macOS Apple Silicon 选择 `aarch64`，Intel 选择 `x64` 的 `.dmg`。

Linux 自动登录需要可用并已解锁的 Secret Service（如 GNOME Keyring 或 KWallet）。macOS 包使用临时签名，尚未经过 Apple 公证；Windows 包未进行代码签名，系统可能要求手动确认打开。
