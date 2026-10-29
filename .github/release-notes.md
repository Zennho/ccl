CCL 是支持 Windows、Linux 和 macOS 的 Minecraft Java 版启动器。

本次更新：

- 最大内存支持手动指定，或在启动时根据设备总内存和当前可用内存自动分配；已有的手动设置会保留。
- 在启动设置中可为当前游戏版本开启或关闭版本隔离，让该版本使用独立的存档、模组和配置目录。
- 切换隔离状态不会移动或删除已有数据；整合包始终使用独立目录，游戏或下载任务运行时无法切换。
- CCL 游戏导出包可保存内存分配模式，并兼容此前导出的配置。

Windows x64 下载 `.exe` 安装程序；Linux x64 下载 `.deb` 或 `.AppImage`；macOS Apple Silicon 选择 `aarch64`，Intel 选择 `x64` 的 `.dmg`。

Linux 自动登录需要可用并已解锁的 Secret Service（如 GNOME Keyring 或 KWallet）。macOS 包使用临时签名，尚未经过 Apple 公证；Windows 包未进行代码签名，系统可能要求手动确认打开。
