package com.idenplane.sdk.jakarta.internal;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class BearerTokenExtractorTest {

    @Test
    void extractsTokenFromWellFormedHeader() {
        assertThat(BearerTokenExtractor.extract("Bearer abc.def.ghi")).isEqualTo("abc.def.ghi");
    }

    @Test
    void returnsNullForMissingHeader() {
        assertThat(BearerTokenExtractor.extract(null)).isNull();
    }

    @Test
    void returnsNullForNonBearerScheme() {
        assertThat(BearerTokenExtractor.extract("Basic dXNlcjpwYXNz")).isNull();
    }

    @Test
    void returnsNullForBearerWithNoToken() {
        assertThat(BearerTokenExtractor.extract("Bearer ")).isNull();
        assertThat(BearerTokenExtractor.extract("Bearer")).isNull();
    }

    @Test
    void trimsWhitespaceAroundToken() {
        assertThat(BearerTokenExtractor.extract("Bearer  abc.def.ghi  ")).isEqualTo("abc.def.ghi");
    }
}
