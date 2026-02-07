import CryptoJS from 'crypto-js';

// Simple MD5 implementation for Subsonic authentication
export default function md5(str: string): string {
    return CryptoJS.MD5(str).toString();
}