Compass Craft Launcher（CCL）是支持 Windows、Linux 和 macOS 的 Minecraft Java 版启动器。

本次更新：

- 已安装模组新增详情，可显示文件内提供的名称、介绍、图标、版本和项目主页；缺少元数据时使用文件名和默认图标。
- 版本管理按正式版、快照版、旧版与自定义实例分组，并支持选择安装官方快照和旧版。
- 较大的游戏本体、Java、资源包以及带校验值的模组与整合包文件支持多连接分段下载；服务端不支持时自动回退，保留校验和取消机制。
- 重构前端入口及功能模块，改善代码结构并补充测试。

Windows x64 下载 `.exe` 安装程序；Linux x64 下载 `.deb` 或 `.AppImage`；macOS Apple Silicon 选择 `aarch64`，Intel 选择 `x64` 的 `.dmg`。

Linux 自动登录需要可用并已解锁的 Secret Service（如 GNOME Keyring 或 KWallet）。macOS 包使用临时签名，尚未经过 Apple 公证；Windows 包未进行代码签名，系统可能要求手动确认打开。
