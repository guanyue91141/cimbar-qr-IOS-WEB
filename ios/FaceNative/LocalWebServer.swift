import Foundation
import Network

/// Serves bundled WebRoot over loopback HTTP so WKWebView has a secure-enough
/// origin for getUserMedia (camera), matching the Android WebViewAssetLoader pattern.
final class LocalWebServer {
    static let shared = LocalWebServer()

    private(set) var port: UInt16 = 8765
    private var listener: NWListener?
    private let queue = DispatchQueue(label: "cn.guanyue.face.ios.webserver")
    private let rootURL: URL

    var baseURL: URL {
        URL(string: "http://127.0.0.1:\(port)/")!
    }

    private init() {
        guard let url = Bundle.main.resourceURL?.appendingPathComponent("WebRoot", isDirectory: true) else {
            fatalError("WebRoot missing from app bundle")
        }
        rootURL = url
    }

    func start() throws {
        if listener != nil { return }

        var usedPort = port
        var lastError: Error?

        for candidate in [port, 18765, 28765, 38765] {
            do {
                let parameters = NWParameters.tcp
                parameters.allowLocalEndpointReuse = true
                let listener = try NWListener(using: parameters, on: NWEndpoint.Port(rawValue: candidate)!)
                listener.newConnectionHandler = { [weak self] connection in
                    self?.handle(connection)
                }
                let started = DispatchSemaphore(value: 0)
                var startError: Error?
                listener.stateUpdateHandler = { state in
                    switch state {
                    case .ready:
                        started.signal()
                    case .failed(let error):
                        startError = error
                        started.signal()
                    default:
                        break
                    }
                }
                listener.start(queue: queue)
                _ = started.wait(timeout: .now() + 2)
                if let startError {
                    listener.cancel()
                    lastError = startError
                    continue
                }
                self.listener = listener
                self.port = candidate
                usedPort = candidate
                print("[LocalWebServer] listening on 127.0.0.1:\(usedPort) root=\(rootURL.path)")
                return
            } catch {
                lastError = error
            }
        }

        throw lastError ?? NSError(domain: "LocalWebServer", code: 1, userInfo: [
            NSLocalizedDescriptionKey: "Unable to bind local web server"
        ])
    }

    func stop() {
        listener?.cancel()
        listener = nil
    }

    private func handle(_ connection: NWConnection) {
        connection.start(queue: queue)
        receive(on: connection, buffer: Data())
    }

    private func receive(on connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
            guard let self else { return }
            if let error {
                print("[LocalWebServer] receive error: \(error)")
                connection.cancel()
                return
            }

            var next = buffer
            if let data, !data.isEmpty {
                next.append(data)
            }

            if let range = next.range(of: Data("\r\n\r\n".utf8)) {
                let headerData = next.subdata(in: next.startIndex..<range.lowerBound)
                self.respond(to: headerData, on: connection)
                return
            }

            if isComplete {
                connection.cancel()
                return
            }

            self.receive(on: connection, buffer: next)
        }
    }

    private func respond(to headerData: Data, on connection: NWConnection) {
        let header = String(data: headerData, encoding: .utf8) ?? ""
        let firstLine = header.split(separator: "\r\n", omittingEmptySubsequences: false).first ?? ""
        let parts = firstLine.split(separator: " ")
        guard parts.count >= 2, parts[0] == "GET" || parts[0] == "HEAD" else {
            send(status: 405, contentType: "text/plain", body: Data("Method Not Allowed".utf8), headOnly: false, on: connection)
            return
        }

        var path = String(parts[1])
        if let q = path.firstIndex(of: "?") {
            path = String(path[..<q])
        }
        path = path.removingPercentEncoding ?? path
        if path == "/" {
            path = "/recv.html"
        }

        let relative = path.hasPrefix("/") ? String(path.dropFirst()) : path
        let fileURL = rootURL.appendingPathComponent(relative).standardizedFileURL

        guard fileURL.path.hasPrefix(rootURL.standardizedFileURL.path),
              FileManager.default.fileExists(atPath: fileURL.path),
              let body = try? Data(contentsOf: fileURL) else {
            send(status: 404, contentType: "text/plain", body: Data("Not Found".utf8), headOnly: false, on: connection)
            return
        }

        send(
            status: 200,
            contentType: mimeType(for: fileURL.pathExtension),
            body: body,
            headOnly: parts[0] == "HEAD",
            on: connection
        )
    }

    private func send(status: Int, contentType: String, body: Data, headOnly: Bool, on connection: NWConnection) {
        let reason: String
        switch status {
        case 200: reason = "OK"
        case 404: reason = "Not Found"
        case 405: reason = "Method Not Allowed"
        default: reason = "Error"
        }

        var header = "HTTP/1.1 \(status) \(reason)\r\n"
        header += "Content-Type: \(contentType)\r\n"
        header += "Content-Length: \(body.count)\r\n"
        header += "Connection: close\r\n"
        header += "Cache-Control: no-cache\r\n"
        header += "Access-Control-Allow-Origin: *\r\n"
        header += "\r\n"

        var payload = Data(header.utf8)
        if !headOnly {
            payload.append(body)
        }

        connection.send(content: payload, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }

    private func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js": return "application/javascript; charset=utf-8"
        case "wasm": return "application/wasm"
        case "json": return "application/json"
        case "css": return "text/css; charset=utf-8"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "ico": return "image/x-icon"
        case "svg": return "image/svg+xml"
        case "txt": return "text/plain; charset=utf-8"
        default: return "application/octet-stream"
        }
    }
}
