# FaceNative iOS

基于 `qr-web`（网页解码器）+ 安卓 `WebViewActivity` 模式的 iOS 壳：WKWebView + 本地 loopback HTTP，相机扫码接收文件。

- Bundle ID: `cn.guanyue.face.ios`
- Team: `KMF5U4LK8D`
- 签名材料：仓库外 `密钥/`（勿提交）

## 一键：上传证书并构建 IPA

在仓库根目录（Windows PowerShell）：

```powershell
# 1) 把本地证书写入 GitHub Actions secrets
.\scripts\ios\setup-secrets.ps1

# 2) 触发 macOS 构建并下载已签名 IPA
.\scripts\ios\build-ipa.ps1
```

等价 `gh` 流程：

```powershell
gh workflow run ios-ipa.yml -R guanyue91141/cimbar-qr-IOS-WEB -f export_method=app-store
gh run watch -R guanyue91141/cimbar-qr-IOS-WEB
gh run download -R guanyue91141/cimbar-qr-IOS-WEB -n FaceNative-ipa -D .\dist\ios
```

## 本地 Mac（可选）

```bash
cd qr-web && npm ci && npm run build && cd ..
rm -rf ios/FaceNative/WebRoot/*
cp -R qr-web/dist/* ios/FaceNative/WebRoot/
brew install xcodegen
cd ios && xcodegen generate
xcodebuild -project FaceNative.xcodeproj -scheme FaceNative \
  -configuration Release -archivePath build/FaceNative.xcarchive archive
xcodebuild -exportArchive -archivePath build/FaceNative.xcarchive \
  -exportOptionsPlist ExportOptions/appstore.plist -exportPath build/ipa
```
