#if CU_HELPER
import Foundation
import AppKit
import Darwin
import ApplicationServices

/// LaunchServices owns this process, keeping capture and AX under one app identity.
@main struct HelperMain {
    @MainActor static var busy = false
    @MainActor static var guide: Process?
    @MainActor static var activeClients = 0
    // Blocking sockets must not occupy Swift's cooperative executor: enough
    // idle peers would otherwise prevent every pending reply from resuming.
    // Admission caps this queue at 32 client operations plus one accept.
    static let socketIO = DispatchQueue(label: "com.opcodehq.helper.socket-io", qos: .userInitiated, attributes: .concurrent)
    static func blockingIO<T>(_ operation: @escaping () -> T) async -> T {
        await withCheckedContinuation { continuation in
            socketIO.async { continuation.resume(returning: operation()) }
        }
    }
    static func readChunk(_ client: Int32) async -> Data? {
        await blockingIO {
            var bytes = [UInt8](repeating: 0, count: 8192)
            while true {
                let count = Darwin.read(client, &bytes, bytes.count)
                if count < 0 && errno == EINTR { continue }
                return count > 0 ? Data(bytes.prefix(count)) : nil
            }
        }
    }
    static func writeReply(_ data: Data, client: Int32) async -> Bool {
        await blockingIO {
            data.withUnsafeBytes { raw -> Bool in
                var offset = 0
                while offset < raw.count {
                    let count = Darwin.write(client, raw.baseAddress!.advanced(by: offset), raw.count - offset)
                    if count < 0 && errno == EINTR { continue }
                    if count <= 0 { return false }
                    offset += count
                }
                return true
            }
        }
    }
    @MainActor static func showPermissionGuide(_ kind: String) {
        if guide?.isRunning == true { guide?.terminate() }
        let process = Process()
        process.executableURL = Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS/permission-guide")
        process.arguments = [Bundle.main.bundlePath, kind]
        let pipe = Pipe()
        process.standardInput = pipe
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do { try process.run() } catch { return }
        guide = process
        Task { @MainActor in
            defer { try? pipe.fileHandleForWriting.close() }
            while process.isRunning {
                let state = ["accessibility": AXIsProcessTrusted(), "screenRecording": CGPreflightScreenCaptureAccess()]
                if var data = try? JSONSerialization.data(withJSONObject: state) {
                    data.append(10)
                    do { try pipe.fileHandleForWriting.write(contentsOf: data) } catch { break }
                }
                try? await Task.sleep(nanoseconds: 1_000_000_000)
            }
        }
    }
    @MainActor static func reply(_ line: Data, driver: Driver) async -> Data {
        var id = ""
        var result: [String: Any]
        do {
            guard line.count <= 128_000,
                  let request = try JSONSerialization.jsonObject(with: line) as? [String: Any],
                  let requestID = request["id"] as? String else { throw DriverFailure(code: "InvalidRequest", message: "Invalid request envelope.") }
            id = requestID
            guard !busy else { throw DriverFailure(code: "DriverBusy", message: "Another connection is using the Mac driver. Retry after its request finishes.") }
            if request["method"] as? String == "helperShutdown" { exit(0) }
            busy = true
            defer { busy = false }
            if request["method"] as? String == "requestAccessibility" { showPermissionGuide("accessibility") }
            if request["method"] as? String == "requestScreenRecording" { showPermissionGuide("screenRecording") }
            var value = try await driver.handle(request)
            if request["method"] as? String == "status", var status = value as? [String: Any] {
                status["permissionOwner"] = "Opcode"
                status["helperBundleID"] = Bundle.main.bundleIdentifier ?? ""
                value = status
            }
            result = ["id": id, "ok": true, "data": value]
        } catch let failure as DriverFailure {
            result = ["id": id, "ok": false, "error": ["code": failure.code, "message": failure.message, "delivery": failure.delivery]]
        } catch {
            result = ["id": id, "ok": false, "error": ["code": "DriverError", "message": error.localizedDescription, "delivery": "notDispatched"]]
        }
        var data = (try? JSONSerialization.data(withJSONObject: result)) ?? Data()
        data.append(10)
        return data
    }
    @MainActor static func main() async {
        _ = NSApplication.shared
        NSApp.setActivationPolicy(.accessory)
        signal(SIGPIPE, SIG_IGN)
        let directory = "/tmp/opcode-cu-\(getuid())"
        let path = directory + "/driver.sock"
        do {
            try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        } catch { /* An existing directory is validated below. */ }
        var metadata = stat()
        guard lstat(directory, &metadata) == 0, metadata.st_uid == getuid(),
              (metadata.st_mode & S_IFMT) == S_IFDIR, (metadata.st_mode & 0o077) == 0 else { exit(1) }
        // flock prevents two LaunchServices instances from unlinking an active endpoint.
        let lock = Darwin.open(directory + "/helper.lock", O_CREAT | O_RDWR | O_NOFOLLOW, 0o600)
        guard lock >= 0, flock(lock, LOCK_EX | LOCK_NB) == 0 else { exit(0) }
        let server = socket(AF_UNIX, SOCK_STREAM, 0)
        guard server >= 0 else { exit(1) }
        unlink(path)
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
        let bytes = Array(path.utf8CString)
        guard bytes.count <= MemoryLayout.size(ofValue: address.sun_path) else { exit(1) }
        withUnsafeMutableBytes(of: &address.sun_path) { target in bytes.withUnsafeBytes { source in target.copyMemory(from: source) } }
        let bound = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.bind(server, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
        }
        guard bound == 0, chmod(path, 0o600) == 0, listen(server, 16) == 0 else { exit(1) }
        while true {
            let client = await blockingIO { Darwin.accept(server, nil, nil) }
            guard client >= 0 else { continue }
            var uid: uid_t = 0, gid: gid_t = 0
            guard getpeereid(client, &uid, &gid) == 0, uid == getuid() else { Darwin.close(client); continue }
            guard activeClients < 32 else { Darwin.close(client); continue }
            // A peer that stops reading must not retain a reply thread forever.
            var writeTimeout = timeval(tv_sec: 10, tv_usec: 0)
            guard setsockopt(client, SOL_SOCKET, SO_SNDTIMEO, &writeTimeout, socklen_t(MemoryLayout<timeval>.size)) == 0 else {
                Darwin.close(client); continue
            }
            activeClients += 1
            let driver = Driver()
            Task { @MainActor in
                defer { Darwin.close(client); activeClients -= 1 }
                var buffer = Data()
                while let chunk = await readChunk(client) {
                    buffer.append(chunk)
                    while let newline = buffer.firstIndex(of: 10) {
                        let line = Data(buffer[..<newline]); buffer.removeSubrange(...newline)
                        if line.count > 128_000 { return }
                        let data = await reply(line, driver: driver)
                        let sent = await writeReply(data, client: client)
                        if !sent { return }
                    }
                    if buffer.count > 128_000 { break }
                }
            }
        }
    }
}
#endif
