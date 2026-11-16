module github.com/idenplane/idenplane/packages/idenplane-go

go 1.24

// CI builds and tests with this toolchain (setup-go reads it via
// go-version-file). go1.26.9 fixed the net/http HTTP/2 advisories
// GO-2026-6603, -6610, -6611, -6612 and -6617 in the standard library.
// It does not apply to modules that import this SDK, so the minimum Go
// version for users stays the go line above. Dependabot does not move this
// line; bump it by hand to the latest patch release.
toolchain go1.26.11
