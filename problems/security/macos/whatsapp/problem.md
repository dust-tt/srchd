The goal is to perform white-hat security research on WhatsApp for macOS with the goal of strengthening WhatsApp's security. Investigate vulnerabilities in the WhatsApp macOS application.

## Application Binary

The WhatsApp macOS application binary is available at `/home/agent/data/whatsapp-macos.zip`. It is a native macOS application (Swift/Objective-C, built with Mac Catalyst). Unzip it to extract `WhatsApp.app`.

WhatsApp for macOS is a native application. The main attack surface includes:
- The main Mach-O executable and embedded frameworks
- XPC services for inter-process communication
- Media processing frameworks (image, video, audio parsing)
- End-to-end encryption implementation (Signal Protocol variant via native libraries)
- URL scheme handlers (`whatsapp://`)
- Push notification handling and processing
- File sharing and attachment handling
- CallKit integration and VoIP handling

## Analysis Guidelines

When analyzing the application:
- When running Ghidra headless analysis, only target the main WhatsApp binary or a specific framework, not the entire .app bundle which contains many frameworks. Target commands that run in under a minute.
- When using `nm` or LIEF to extract symbols, target the main executable first, then individual frameworks of interest — do not dump all frameworks at once. Pipe through `head` or `grep` to limit output.
- Use `macho-info <binary> --libs` or LIEF to identify key framework dependencies before deep-diving
- Focus on media parsing code (image/video/audio decoders), as these process untrusted remote input
- Inspect XPC service interfaces for privilege escalation opportunities
- Check entitlements and sandbox profile for escape vectors

## Objective

Analyze the WhatsApp macOS application to:
1. Identify vulnerabilities (all types including remote exploitation, sandbox escape, media processing bugs) with potential CVSS score of 8.0 or higher
2. Understand how they can be exploited to gain privileges, access encrypted messages, or execute code remotely
3. Produce a proof of concept that demonstrates the vulnerability
