package com.idenplane.sdk.reactive;

import com.idenplane.sdk.IdenplaneClient;
import com.idenplane.sdk.models.OpenIDConfiguration;
import com.idenplane.sdk.models.TokenClaims;
import com.idenplane.sdk.models.TokenResponse;
import com.idenplane.sdk.models.UserInfo;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Scheduler;
import reactor.core.scheduler.Schedulers;

import java.util.List;
import java.util.Objects;

/**
 * Reactive (Project Reactor) wrapper around {@link IdenplaneClient}.
 *
 * <p>{@code IdenplaneClient} itself is synchronous — it uses blocking HTTP I/O internally, which
 * would stall a WebFlux event loop thread if called directly. Every operation here that can
 * perform I/O (including {@link #buildAuthorizationUrl} and {@link #buildLogoutUrl}, which read
 * the cached discovery document and can trigger a blocking fetch on a cold cache) runs on
 * {@link Schedulers#boundedElastic()} instead.
 *
 * <p>{@link com.idenplane.sdk.PkceUtil} is pure CPU-bound work with no I/O — use it directly,
 * it doesn't need a reactive wrapper.
 */
public final class ReactiveIdenplaneClient {

    private final IdenplaneClient delegate;
    private final Scheduler scheduler;

    private ReactiveIdenplaneClient(IdenplaneClient delegate, Scheduler scheduler) {
        this.delegate = delegate;
        this.scheduler = scheduler;
    }

    /**
     * Wraps an existing {@link IdenplaneClient}, dispatching its blocking calls to
     * {@link Schedulers#boundedElastic()}.
     *
     * @param delegate the client to wrap
     * @return a reactive wrapper around it
     */
    public static ReactiveIdenplaneClient wrap(IdenplaneClient delegate) {
        return wrap(delegate, Schedulers.boundedElastic());
    }

    /**
     * Wraps an existing {@link IdenplaneClient}, dispatching its blocking calls to the given
     * scheduler. Intended for tests that want a deterministic/synchronous scheduler instead of
     * {@code boundedElastic()}.
     *
     * @param delegate  the client to wrap
     * @param scheduler the scheduler to run blocking calls on
     * @return a reactive wrapper around it
     */
    public static ReactiveIdenplaneClient wrap(IdenplaneClient delegate, Scheduler scheduler) {
        Objects.requireNonNull(delegate, "delegate is required");
        Objects.requireNonNull(scheduler, "scheduler is required");
        return new ReactiveIdenplaneClient(delegate, scheduler);
    }

    /**
     * @see IdenplaneClient#discover()
     */
    public Mono<OpenIDConfiguration> discover() {
        return blocking(delegate::discover);
    }

    /**
     * @see IdenplaneClient#validateIdToken(String)
     */
    public Mono<TokenClaims> validateIdToken(String idToken) {
        return blocking(() -> delegate.validateIdToken(idToken));
    }

    /**
     * @see IdenplaneClient#validateAccessToken(String)
     */
    public Mono<TokenClaims> validateAccessToken(String accessToken) {
        return blocking(() -> delegate.validateAccessToken(accessToken));
    }

    /**
     * @see IdenplaneClient#buildAuthorizationUrl(String, String, String, List)
     */
    public Mono<String> buildAuthorizationUrl(String redirectUri, String state, String codeChallenge,
                                               List<String> scopes) {
        return blocking(() -> delegate.buildAuthorizationUrl(redirectUri, state, codeChallenge, scopes));
    }

    /**
     * @see IdenplaneClient#exchangeAuthorizationCode(String, String, String)
     */
    public Mono<TokenResponse> exchangeAuthorizationCode(String code, String redirectUri, String codeVerifier) {
        return blocking(() -> delegate.exchangeAuthorizationCode(code, redirectUri, codeVerifier));
    }

    /**
     * @see IdenplaneClient#refreshToken(String)
     */
    public Mono<TokenResponse> refreshToken(String refreshToken) {
        return blocking(() -> delegate.refreshToken(refreshToken));
    }

    /**
     * @see IdenplaneClient#getUserInfo(String)
     */
    public Mono<UserInfo> getUserInfo(String accessToken) {
        return blocking(() -> delegate.getUserInfo(accessToken));
    }

    /**
     * @see IdenplaneClient#buildLogoutUrl(String, String)
     */
    public Mono<String> buildLogoutUrl(String idTokenHint, String postLogoutRedirectUri) {
        return blocking(() -> delegate.buildLogoutUrl(idTokenHint, postLogoutRedirectUri));
    }

    private <T> Mono<T> blocking(java.util.concurrent.Callable<T> call) {
        return Mono.fromCallable(call).subscribeOn(scheduler);
    }
}
