import Capacitor

// Capacitor 8 requires custom native plugins that aren't distributed as npm/SPM plugin
// packages to be explicitly registered via bridge?.registerPluginInstance(...) inside
// capacitorDidLoad() — conforming to CAPBridgedPlugin alone is not sufficient. This
// subclass replaces the default CAPBridgeViewController set in Main.storyboard.
// See https://capacitorjs.com/docs/ios/custom-code#register-the-plugin
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(BackgroundDownloadPlugin())
        bridge?.registerPluginInstance(BackgroundKeepAlivePlugin())
    }
}
