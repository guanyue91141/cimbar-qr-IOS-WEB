### [简介](https://github.com/sz3/cimbar) | [关于](https://github.com/sz3/cimbar/blob/master/ABOUT.md) | CFC | [LIBCIMBAR](https://github.com/sz3/libcimbar)

## CameraFileCopy (相机文件传输)

这是一个 Android 应用，用于通过摄像头作为单向数据通道接收数据。它不使用任何天线（WiFi、蓝牙、NFC 等）或其他技巧。值得注意的是，这意味着它在飞行模式下也能正常工作。

该应用读取动画 [cimbar 编码](https://github.com/sz3/libcimbar)。几乎所有有趣的逻辑都来自 libcimbar -- 通过 git subtree 包含进来。

CFC 的*发送端*是一个 cimbar 编码器 -- 例如 https://cimbar.org。导航到该网站（或使用 libcimbar 的 `cimbar_send` 原生生成条形码），打开文件初始化 cimbar 流，然后将应用和摄像头对准动画条形码即可。

## 当前版本特性

### v2.0.0
- ✅ **中文本地化支持**：完整的中文界面翻译
- ✅ **移动端优化**：支持 Android 和 iOS 设备
- ✅ **iOS 兼容**：适配 iOS Safari/Chrome（需 HTTPS）
- ✅ **深色模式**：OLED 风格的深色主题 UI
- ✅ **响应式设计**：适配各种屏幕尺寸
- ✅ **安全区域适配**：支持 iPhone 刘海屏和底部安全区域
- ✅ **PWA 支持**：可安装到主屏幕

## 发布 APK

[<img src="https://fdroid.gitlab.io/artwork/badge/get-it-on.png"
     alt="在 F-Droid 下载"
     height="80">](https://f-droid.org/packages/org.cimbar.camerafilecopy/)
[<img src="https://play.google.com/intl/en_us/badges/images/generic/en-play-badge.png"
     alt="在 Google Play 下载"
     height="80">](https://play.google.com/store/apps/details?id=org.cimbar.camerafilecopy)

发布的 APK 也可在此处下载：https://github.com/sz3/cfc/releases/

目前官方仅支持 arm64-v8a 架构，因为这是我能够测试的全部。

## 构建指南

1. 安装 Android Studio
2. 安装 Android NDK
3. 下载 [OpenCV for Android](https://github.com/opencv/opencv/releases/download/4.5.0/opencv-4.5.0-android-sdk.zip)
4. 以本仓库为根目录创建项目
5. 更新 `gradle.properties`，使 `opencvsdk` 指向您解压 OpenCV Android SDK 的位置

我发现这个项目对入门非常有帮助：

https://github.com/VlSomers/native-opencv-android-template

## 许可证、依赖等

CFC 中的代码（如果有的话）采用 MIT 许可证。它主要是各种教程应用和 libcimbar 包装代码的混合体。

libcimbar 代码采用 MPL 2.0 许可证。libcimbar 的依赖包括各种 MIT、BSD、zlib、boost、apache 等许可证的库。