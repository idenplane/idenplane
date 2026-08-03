package com.idenplane.sdk;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.HashSet;
import java.util.Set;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

class PkceUtilTest {

    private static final Pattern UNRESERVED = Pattern.compile("^[A-Za-z0-9\\-._~]+$");

    @Test
    void generateCodeVerifier_isWithinRfc7636LengthAndCharsetBounds() {
        String verifier = PkceUtil.generateCodeVerifier();

        assertThat(verifier.length()).isBetween(43, 128);
        assertThat(UNRESERVED.matcher(verifier).matches()).isTrue();
    }

    @Test
    void generateCodeVerifier_isRandomAcrossCalls() {
        Set<String> verifiers = new HashSet<>();
        for (int i = 0; i < 100; i++) {
            verifiers.add(PkceUtil.generateCodeVerifier());
        }

        assertThat(verifiers).hasSize(100);
    }

    @Test
    void deriveCodeChallenge_matchesManuallyComputedSha256() throws Exception {
        String verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

        String challenge = PkceUtil.deriveCodeChallenge(verifier);

        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] expectedHash = digest.digest(verifier.getBytes(StandardCharsets.US_ASCII));
        String expected = Base64.getUrlEncoder().withoutPadding().encodeToString(expectedHash);
        assertThat(challenge).isEqualTo(expected);
        // RFC 7636 appendix B worked example.
        assertThat(challenge).isEqualTo("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    @Test
    void deriveCodeChallenge_isDeterministic() {
        String verifier = PkceUtil.generateCodeVerifier();

        assertThat(PkceUtil.deriveCodeChallenge(verifier)).isEqualTo(PkceUtil.deriveCodeChallenge(verifier));
    }
}
