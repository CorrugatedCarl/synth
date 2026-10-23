import UIKit

// SYNTH — the iPad app (IMPL-A): one window, one scene, one full-screen WKWebView (ShellViewController) serving the bundled
// site over synth://app/. The session is configured before the page loads (§5.1); files opened from the Files app reach the
// page through the scene's URL contexts (§4.3); the iPadOS 26 window controls take as little of the scene as they can (§6.3).
@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        AudioSession.shared.configure()
        FileExport.sweep()
        return true
    }
    func applicationDidReceiveMemoryWarning(_ application: UIApplication) { Smoke.log(["k": "memory", "warning": true]) }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    private weak var shell: ShellViewController?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let ws = scene as? UIWindowScene else { return }
        let vc = ShellViewController()
        let w = UIWindow(windowScene: ws)
        w.backgroundColor = ShellViewController.bg
        w.rootViewController = vc
        w.makeKeyAndVisible()
        window = w
        shell = vc
        open(connectionOptions.urlContexts)          // a cold start from a file: queued until the page is ready (§4.3)
    }
    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) { open(URLContexts) }
    private func open(_ ctxs: Set<UIOpenURLContext>) { for c in ctxs { shell?.openDocument(c.url) } }

    func sceneDidBecomeActive(_ scene: UIScene) { Smoke.log(["k": "scene", "state": "active"]); shell?.sceneActive(true) }
    func sceneWillResignActive(_ scene: UIScene) { Smoke.log(["k": "scene", "state": "inactive"]); shell?.sceneActive(false) }
    func sceneDidEnterBackground(_ scene: UIScene) { Smoke.log(["k": "scene", "state": "background"]); shell?.sceneBackground(true) }
    func sceneWillEnterForeground(_ scene: UIScene) { Smoke.log(["k": "scene", "state": "foreground"]); shell?.sceneBackground(false) }

    @available(iOS 26.0, *)
    func preferredWindowingControlStyle(for windowScene: UIWindowScene) -> UIWindowScene.WindowingControlStyle { .minimal }
}
