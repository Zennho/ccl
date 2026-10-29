CCL 是支持 Windows、Linux 和 macOS 的 Minecraft Java 版启动器。

本次更新：

- 新增材质包和光影包下载：可从 Modrinth 或 CurseForge 浏览、搜索和排序，选择已安装的游戏版本以及具体资源包版本。
- 下载任务支持取消和重试，文件自动保存到目标游戏目录，并显示通过 CCL 安装的项目状态。
- 资源包按游戏版本筛选，下载时校验文件；单个文件上限为 512 MB。
- 更新 README，补充资源包使用说明与界面展示。

材质包和光影包下载后需在游戏中启用；光影还需自行安装 Iris、OptiFine 等支持光影的组件。CurseForge 需要 API Key，部分作者可能限制第三方下载。

Windows x64 下载 `.exe` 安装程序；Linux x64 下载 `.deb` 或 `.AppImage`；macOS Apple Silicon 选择 `aarch64`，Intel 选择 `x64` 的 `.dmg`。

Linux 自动登录需要可用并已解锁的 Secret Service（如 GNOME Keyring 或 KWallet）。macOS 包使用临时签名，尚未经过 Apple 公证；Windows 包未进行代码签名，系统可能要求手动确认打开。
