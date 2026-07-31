// SPDX-License-Identifier: MPL-2.0
package dev.elatura.notificationcompanion

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.KeyGenerator
import javax.crypto.Mac
import javax.crypto.SecretKey

internal class AndroidKeystoreHmacSigner(
    private val alias: String = KEY_ALIAS,
) : TokenSigner {
    override fun hmacSha256Hex(label: String, value: String): String {
        require(label.isNotBlank()) { "label must not be blank" }
        val key = getOrCreateKey()
        val mac = Mac.getInstance(HMAC_ALGORITHM)
        mac.init(key)
        mac.update(label.toByteArray(StandardCharsets.UTF_8))
        mac.update(0)
        val digest = mac.doFinal(value.toByteArray(StandardCharsets.UTF_8))
        return digest.toHex()
    }

    @Synchronized
    private fun getOrCreateKey(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        val existing = keyStore.getKey(alias, null) as? SecretKey
        if (existing != null) return existing

        val generator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_HMAC_SHA256,
            ANDROID_KEYSTORE,
        )
        generator.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
                .setDigests(KeyProperties.DIGEST_SHA256)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    companion object {
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val HMAC_ALGORITHM = "HmacSHA256"
        private const val KEY_ALIAS = "elatura-completion-hint-hmac-v1"

        fun deleteKey(alias: String = KEY_ALIAS) {
            val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
            if (keyStore.containsAlias(alias)) {
                keyStore.deleteEntry(alias)
            }
        }
    }
}

private fun ByteArray.toHex(): String {
    val alphabet = "0123456789abcdef"
    val output = CharArray(size * 2)
    forEachIndexed { index, byte ->
        val value = byte.toInt() and 0xff
        output[index * 2] = alphabet[value ushr 4]
        output[index * 2 + 1] = alphabet[value and 0x0f]
    }
    return output.concatToString()
}
