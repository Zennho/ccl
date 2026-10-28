CCL 是支持 Windows、Linux 和 macOS 的 Minecraft Java 版启动器。

本次更新：

- 重新设计游戏启动页面，沿用启动器自定义背景、横幅及磨砂效果。
- 游戏进程启动成功后自动返回主页；启动失败时保留错误信息与日志入口。
- 支持 PCL 导出的 Modrinth `.mrpack` 整合包导入及兼容格式导出，保留模组、配置和可选存档。

PCL 兼容导出支持原版、Fabric、Forge 和 NeoForge，不包含 CCL 专用启动参数；PCL 不支持 Quilt。导入 `.mrpack` 时会安装可选客户端文件。

Windows x64 下载 `.exe` 安装程序；Linux x64 下载 `.deb` 或 `.AppImage`；macOS Apple Silicon 选择 `aarch64`，Intel 选择 `x64` 的 `.dmg`。

微软正版登录需要 CCL 的微软应用获得 Minecraft 服务授权；审核状态以 Minecraft 官方回复为准。IPv6 跨网络联机需要双方网络互通，房主防火墙和路由器允许入站连接。

macOS 包使用临时签名，尚未经过 Apple 公证；Windows 包未进行代码签名。系统可能要求手动确认打开。
