package com.hoshikuzu.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.security.KeyStore;
import java.security.SecureRandom;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Android Keystore-backed storage for AI / cloud credentials. Mirrors the
 * desktop safeStorage contract: ciphertext only leaves this class.
 */
final class SecureStore {
    private static final String PREFS = "hoshikuzu_mobile_secure";
    private static final String KEY_ALIAS = "hoshikuzu-mobile-secrets";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;

    private final SharedPreferences preferences;

    SecureStore(Context context) {
        preferences = context.getApplicationContext()
                .getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    synchronized String get(String key) {
        String encoded = preferences.getString(key, null);
        if (encoded == null || encoded.isEmpty()) return null;
        try {
            byte[] packed = Base64.decode(encoded, Base64.NO_WRAP);
            if (packed.length <= IV_BYTES) return null;
            byte[] iv = new byte[IV_BYTES];
            System.arraycopy(packed, 0, iv, 0, IV_BYTES);
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), new GCMParameterSpec(TAG_BITS, iv));
            byte[] plain = cipher.doFinal(packed, IV_BYTES, packed.length - IV_BYTES);
            return new String(plain, java.nio.charset.StandardCharsets.UTF_8);
        } catch (Exception error) {
            return null;
        }
    }

    synchronized boolean set(String key, String value) {
        if (value == null || value.isEmpty()) return delete(key);
        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            byte[] iv = new byte[IV_BYTES];
            new SecureRandom().nextBytes(iv);
            cipher.init(Cipher.ENCRYPT_MODE, secretKey(), new GCMParameterSpec(TAG_BITS, iv));
            byte[] encrypted = cipher.doFinal(
                    value.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            byte[] packed = new byte[IV_BYTES + encrypted.length];
            System.arraycopy(iv, 0, packed, 0, IV_BYTES);
            System.arraycopy(encrypted, 0, packed, IV_BYTES, encrypted.length);
            return preferences.edit()
                    .putString(key, Base64.encodeToString(packed, Base64.NO_WRAP))
                    .commit();
        } catch (Exception error) {
            return false;
        }
    }

    synchronized boolean delete(String key) {
        return preferences.edit().remove(key).commit();
    }

    private SecretKey secretKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) {
            return (SecretKey) keyStore.getKey(KEY_ALIAS, null);
        }
        KeyGenerator generator = KeyGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build());
        return generator.generateKey();
    }
}
