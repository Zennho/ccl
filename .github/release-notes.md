Compass Craft Launcher（CCL）是支持 Windows、Linux 和 macOS 的 Minecraft Java 版启动器。

本次更新：

- 缓存正版玩家头像：启动时先显示本机缓存，后台验证并获取最新皮肤后自动更新；不同账户的缓存相互独立。
- 右上角头像改为方形，保持 Minecraft 像素头像的完整外形。
- 修复资源包相关测试在并行运行时共用临时目录导致的偶发失败。

首次成功获取正版皮肤后会建立头像缓存；网络或凭据库不可用时，缓存头像不代表账户已通过验证。

Windows x64 下载 `.exe` 安装程序；Linux x64 下载 `.deb` 或 `.AppImage`；macOS Apple Silicon 选择 `aarch64`，Intel 选择 `x64` 的 `.dmg`。

Linux 自动登录需要可用并已解锁的 Secret Service（如 GNOME Keyring 或 KWallet）。macOS 包使用临时签名，尚未经过 Apple 公证；Windows 包未进行代码签名，系统可能要求手动确认打开。
