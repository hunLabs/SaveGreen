package com.example.co2.util;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

public class HashUtils {
    private HashUtils() {}

    public static String sha256Hex(String input){
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(input.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(hash.length * 2);
            for (byte b : hash) {
                String hex = Integer.toHexString(0xff & b);
                if (hex.length() == 1) sb.append('0');
                sb.append(hex);
            }
            return sb.toString();
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 not supported", e);
        }
    }
}
