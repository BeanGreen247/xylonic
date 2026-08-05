import Foundation
import AVFoundation
import Capacitor

@objc(BackgroundKeepAlivePlugin)
public class BackgroundKeepAlivePlugin: CAPPlugin, CAPBridgedPlugin {

    // See BackgroundDownloadPlugin.swift for why this explicit registration replaced
    // the old Objective-C CAP_PLUGIN macro approach.
    public let identifier = "BackgroundKeepAlivePlugin"
    public let jsName = "BackgroundKeepAlive"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "arm",     returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disarm",  returnType: CAPPluginReturnPromise),
    ]

    private var audioEngine: AVAudioEngine?
    private var isArmed = false    // JS has active downloads pending
    private var isRunning = false  // silent audio engine is currently playing

    public override func load() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(appDidEnterBackground),
            name: UIApplication.didEnterBackgroundNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(appWillEnterForeground),
            name: UIApplication.willEnterForegroundNotification,
            object: nil
        )
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    // MARK: - Plugin methods

    @objc func arm(_ call: CAPPluginCall) {
        isArmed = true
        call.resolve()
    }

    @objc func disarm(_ call: CAPPluginCall) {
        isArmed = false
        if isRunning { stopSilence() }
        call.resolve()
    }

    // MARK: - App lifecycle

    @objc private func appDidEnterBackground() {
        if isArmed && !isRunning { startSilence() }
    }

    @objc private func appWillEnterForeground() {
        if isRunning { stopSilence() }
    }

    // MARK: - Silent audio engine

    private func startSilence() {
        do {
            // .mixWithOthers: coexist with music already playing from WKWebView or elsewhere
            try AVAudioSession.sharedInstance().setCategory(.playback, options: [.mixWithOthers])
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            return // Can't activate audio session — fall back to completion log recovery
        }

        let engine = AVAudioEngine()
        let player = AVAudioPlayerNode()
        engine.attach(player)

        // Mono 44.1 kHz format — minimal resource use
        guard let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 1) else { return }
        engine.connect(player, to: engine.mainMixerNode, format: format)
        // outputVolume = 0 on the mixer: belt-and-suspenders in case the zeroed buffer
        // somehow produces a floating-point artefact through the DAC chain.
        engine.mainMixerNode.outputVolume = 0

        // 1-second zeroed buffer looped forever — Swift zero-initialises the channel data,
        // so this is genuinely silent without needing an audio file asset.
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 44100) else { return }
        buffer.frameLength = buffer.frameCapacity

        player.scheduleBuffer(buffer, at: nil, options: .loops)

        do {
            try engine.start()
        } catch {
            return
        }

        player.play()
        audioEngine = engine
        isRunning = true
    }

    private func stopSilence() {
        audioEngine?.stop()
        audioEngine = nil
        isRunning = false
        // Do not call setActive(false) — WKWebView may still need the session for music.
        // iOS deactivates it automatically once no audio is being produced.
    }
}
