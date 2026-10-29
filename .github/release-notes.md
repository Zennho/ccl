CCL 是支持 Windows、Linux 和 macOS 的 Minecraft Java 版启动器。

本次更新：

- 优化内容浏览：新增分类筛选，整合包可按游戏版本和加载器筛选；Modrinth 支持运行环境筛选和短期结果缓存。
- 改进下载可靠性：带校验值的游戏文件及材质包、光影包使用临时文件流式下载；连接中断后自动有限重试，服务器支持时在当前任务内续传，完成后校验文件。
- 新增实例概览，查看游戏版本、加载器、资源数量、目录占用和最近启动时间。
- 新增材质包和光影包管理、下载速度显示及光影环境检测。
- 优化游戏崩溃诊断，对常见问题给出可能原因、排查建议和完整日志入口。

资源包需在游戏中启用；光影还需 Iris、Oculus 或 OptiFine 等组件。CurseForge 需要 API Key，部分作者可能限制第三方下载。

Windows x64 下载 `.exe` 安装程序；Linux x64 下载 `.deb` 或 `.AppImage`；macOS Apple Silicon 选择 `aarch64`，Intel 选择 `x64` 的 `.dmg`。

Linux 自动登录需要可用并已解锁的 Secret Service（如 GNOME Keyring 或 KWallet）。macOS 包使用临时签名，尚未经过 Apple 公证；Windows 包未进行代码签名，系统可能要求手动确认打开。
