CCL 是支持 Windows、Linux 和 macOS 的 Minecraft Java 版启动器。

本次更新：

- 新增自动更新检查：启动后及运行期间定期检查 GitHub 最新正式版，发现新版本时显示提示；也可在启动设置中手动检查并前往 Release 页面下载。
- 优化正版账户恢复：在线账户在后台恢复登录，首页无需等待；启动游戏时若尚未登录，会等待或重新尝试验证。离线账户不等待正版验证。
- 正版验证失败时提供账户入口，不会自动以离线身份启动。

自动更新检查只提供下载页面，不会自动安装或替换程序。GitHub 无法访问时不会影响启动器的其他功能。

Windows x64 下载 `.exe` 安装程序；Linux x64 下载 `.deb` 或 `.AppImage`；macOS Apple Silicon 选择 `aarch64`，Intel 选择 `x64` 的 `.dmg`。

Linux 自动登录需要可用并已解锁的 Secret Service（如 GNOME Keyring 或 KWallet）。macOS 包使用临时签名，尚未经过 Apple 公证；Windows 包未进行代码签名，系统可能要求手动确认打开。
