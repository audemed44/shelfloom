// Package hashing computes the file fingerprints Shelfloom matches books by.
package hashing

import (
	"crypto/md5"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
)

// Files returns the SHA-256 and MD5 of a file, as hex.
func Files(path string) (sha, md5hex string, err error) {
	f, err := os.Open(path)
	if err != nil {
		return "", "", err
	}
	defer f.Close()
	s, m := sha256.New(), md5.New()
	if _, err := io.Copy(io.MultiWriter(s, m), f); err != nil {
		return "", "", err
	}
	return hex.EncodeToString(s.Sum(nil)), hex.EncodeToString(m.Sum(nil)), nil
}

// Bytes returns the SHA-256 and MD5 of data, as hex.
func Bytes(data []byte) (sha, md5hex string) {
	s := sha256.Sum256(data)
	m := md5.Sum(data)
	return hex.EncodeToString(s[:]), hex.EncodeToString(m[:])
}

// KOReaderPartialMD5 is KOReader's util.partialMD5(): the MD5 of up to 12
// chunks of 1024 bytes at offsets 1024 << (2*i) for i = -1..10, with
// LuaJIT's 32-bit shifts (shift count masked to 5 bits, result to 32 bits),
// so i = -1 reads from offset 0. It is the digest KOReader identifies a
// document by in .sdr metadata, its statistics database and progress sync.
// ok is false when the file can't be opened.
func KOReaderPartialMD5(path string) (digest string, ok bool) {
	f, err := os.Open(path)
	if err != nil {
		return "", false
	}
	defer f.Close()
	h := md5.New()
	buf := make([]byte, 1024)
	for i := -1; i <= 10; i++ {
		shift := uint((2 * i) & 31)
		offset := int64((uint64(1024) << shift) & 0xFFFFFFFF)
		n, err := f.ReadAt(buf, offset)
		if n == 0 {
			break
		}
		h.Write(buf[:n])
		if err != nil && err != io.EOF {
			break
		}
	}
	return hex.EncodeToString(h.Sum(nil)), true
}
