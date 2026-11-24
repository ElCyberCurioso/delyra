package app.delyra.core.network

import okhttp3.OkHttpClient

/** En release no hay log HTTP. */
fun OkHttpClient.Builder.addDebugInterceptors(): OkHttpClient.Builder = this
