import UIKit
import AVFoundation

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        requestCameraAccessIfNeeded()

        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = WebShellViewController()
        window.makeKeyAndVisible()
        self.window = window
        return true
    }

    private func requestCameraAccessIfNeeded() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { _ in }
        default:
            break
        }
    }
}
