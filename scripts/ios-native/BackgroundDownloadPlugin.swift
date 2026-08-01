import Foundation
import Capacitor

@objc(BackgroundDownloadPlugin)
public class BackgroundDownloadPlugin: CAPPlugin, URLSessionDownloadDelegate {

    public static let sessionIdentifier = "xylonic.background.download"
    public static var backgroundCompletionHandler: (() -> Void)?

    private var urlSession: URLSession?
    private let completionLogKey = "xylonic_ios_bg_download_log"
    private let serialQueue = DispatchQueue(label: "xylonic.bgdownload.serial", qos: .utility)

    public override func load() {
        let config = URLSessionConfiguration.background(withIdentifier: Self.sessionIdentifier)
        config.sessionSendsLaunchEvents = true
        config.isDiscretionary = false
        urlSession = URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }

    // MARK: - Plugin methods

    @objc func startDownload(_ call: CAPPluginCall) {
        guard
            let urlStr   = call.getString("url"),
            let url      = URL(string: urlStr),
            let songId   = call.getString("songId"),
            let audioHash = call.getString("audioHash")
        else {
            call.reject("Missing required parameters: url, songId, audioHash")
            return
        }

        var request = URLRequest(url: url)
        if let headers = call.getObject("headers") as? [String: String] {
            for (key, value) in headers { request.setValue(value, forHTTPHeaderField: key) }
        }

        let task = urlSession!.downloadTask(with: request)
        // Encode both IDs in taskDescription so we don't need an in-memory map
        // that would be lost if the process is killed during the transfer.
        task.taskDescription = "\(songId)|\(audioHash)"
        task.resume()
        call.resolve()
    }

    @objc func cancelDownload(_ call: CAPPluginCall) {
        guard let songId = call.getString("songId") else {
            call.reject("Missing songId")
            return
        }
        urlSession?.getAllTasks { tasks in
            for task in tasks where task.taskDescription?.hasPrefix("\(songId)|") == true {
                task.cancel()
            }
        }
        call.resolve()
    }

    @objc func readCompletionLog(_ call: CAPPluginCall) {
        let log = UserDefaults.standard.array(forKey: completionLogKey) as? [[String: Any]] ?? []
        call.resolve(["entries": log])
    }

    @objc func clearCompletionLog(_ call: CAPPluginCall) {
        UserDefaults.standard.removeObject(forKey: completionLogKey)
        call.resolve()
    }

    // MARK: - URLSessionDownloadDelegate

    public func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didFinishDownloadingTo location: URL
    ) {
        guard let desc = downloadTask.taskDescription else { return }
        let parts = desc.split(separator: "|", maxSplits: 1).map(String.init)
        guard parts.count == 2 else { return }
        let songId    = parts[0]
        let audioHash = parts[1]

        let mimeType = (downloadTask.response as? HTTPURLResponse)?
            .value(forHTTPHeaderField: "Content-Type") ?? "audio/mpeg"
        let ext = mimeTypeToExtension(mimeType)

        // Mirror the path that capacitorBridge.saveAudioFile() writes:
        // <Documents>/permanent_cache/audio/<hash>/audio<ext>
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let destDir  = docs.appendingPathComponent("permanent_cache/audio/\(audioHash)", isDirectory: true)
        let destFile = destDir.appendingPathComponent("audio\(ext)")

        do {
            try FileManager.default.createDirectory(at: destDir, withIntermediateDirectories: true)
            if FileManager.default.fileExists(atPath: destFile.path) {
                try FileManager.default.removeItem(at: destFile)
            }
            try FileManager.default.moveItem(at: location, to: destFile)
            let attrs    = try FileManager.default.attributesOfItem(atPath: destFile.path)
            let fileSize = (attrs[.size] as? Int) ?? 0

            // Persist to completion log so the next cold-start reconcile can
            // register songs whose events were delivered while the WebView was dead.
            let entry: [String: Any] = [
                "songId": songId, "audioHash": audioHash,
                "extension": ext, "fileSize": fileSize,
            ]
            serialQueue.async { self.appendToCompletionLog(entry) }

            notifyListeners("backgroundDownloadCompleted", data: [
                "songId": songId, "audioHash": audioHash,
                "extension": ext, "fileSize": fileSize,
            ])
        } catch {
            notifyListeners("backgroundDownloadFailed", data: [
                "songId": songId, "error": error.localizedDescription,
            ])
        }
    }

    public func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: Error?
    ) {
        // Only fires for network/transport errors (not for successful completions,
        // which already called didFinishDownloadingTo above).
        guard let error = error, let desc = task.taskDescription else { return }
        let songId = String(desc.split(separator: "|").first ?? Substring(desc))
        notifyListeners("backgroundDownloadFailed", data: [
            "songId": songId, "error": error.localizedDescription,
        ])
    }

    public func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        // Must be called on the main thread to signal to iOS that background processing is done.
        DispatchQueue.main.async {
            Self.backgroundCompletionHandler?()
            Self.backgroundCompletionHandler = nil
        }
    }

    // MARK: - Helpers

    private func appendToCompletionLog(_ entry: [String: Any]) {
        var log = UserDefaults.standard.array(forKey: completionLogKey) as? [[String: Any]] ?? []
        log.append(entry)
        UserDefaults.standard.set(log, forKey: completionLogKey)
    }

    private func mimeTypeToExtension(_ mime: String) -> String {
        if mime.contains("ogg")  { return ".ogg" }
        if mime.contains("flac") { return ".flac" }
        if mime.contains("m4a") || mime.contains("mp4a") || mime.contains("aac") { return ".m4a" }
        if mime.contains("wav")  { return ".wav" }
        return ".mp3"
    }
}
