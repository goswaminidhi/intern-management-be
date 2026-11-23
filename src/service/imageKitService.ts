import 'dotenv/config';
import ImageKit from 'imagekit';
import { encryptBuffer, decryptBuffer } from './cryptoService';

// 1. Validate environment configuration
const publicKey = process.env.IMAGEKIT_PUBLIC_KEY?.trim();
const privateKey = process.env.IMAGEKIT_PRIVATE_KEY?.trim();
const urlEndpoint = process.env.IMAGEKIT_URL_ENDPOINT?.trim();

if (!publicKey || !privateKey || !urlEndpoint) {
  console.warn(
    'WARNING: ImageKit credentials missing in .env (IMAGEKIT_PUBLIC_KEY, IMAGEKIT_PRIVATE_KEY, IMAGEKIT_URL_ENDPOINT).'
  );
}

// 2. Initialize ImageKit instance
export const imagekit = new ImageKit({
  publicKey: publicKey || '',
  privateKey: privateKey || '',
  urlEndpoint: urlEndpoint || '',
});

// 3. Normalized response interface
export interface UploadedCloudFile {
  fileId: string;
  url: string;
  name: string;
  size: number;
  filePath: string;
}

/**
 * Encrypts a file buffer and uploads the encrypted ciphertext directly to ImageKit.
 *
 * @param buffer - Plaintext file content buffer (from multer memoryStorage)
 * @param fileName - Original or sanitized file name
 * @param folder - Target folder path in ImageKit (e.g. '/chat', '/tasks', '/submissions')
 */
export async function uploadToImageKit(
  buffer: Buffer,
  fileName: string,
  folder: string = '/chat'
): Promise<UploadedCloudFile> {
  try {
    // App-level encryption: encrypt file buffer before uploading to cloud
    const encryptedBuffer = encryptBuffer(buffer);

    const response = await imagekit.upload({
      file: encryptedBuffer,
      fileName,
      folder,
      useUniqueFileName: true,
    });

    return {
      fileId: response.fileId,
      url: response.url,
      name: response.name,
      size: response.size,
      filePath: response.filePath,
    };
  } catch (error: any) {
    console.error('ImageKit upload error:', error);
    throw new Error(error?.message || 'Failed to upload file to ImageKit');
  }
}

/**
 * Downloads an encrypted file from ImageKit and decrypts it back to plaintext.
 *
 * @param url - Direct ImageKit CDN URL
 * @returns Decrypted plaintext Buffer
 */
export async function fetchAndDecryptFromImageKit(url: string): Promise<Buffer> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch file from ImageKit: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const encryptedBuffer = Buffer.from(arrayBuffer);

    try {
      // Decrypt using AES-256-GCM
      return decryptBuffer(encryptedBuffer);
    } catch (decryptErr) {
      // Fallback: If decryption fails, the file might be an older legacy file uploaded before encryption was added
      console.warn('Decryption failed, falling back to raw buffer (legacy file):', decryptErr);
      return encryptedBuffer;
    }
  } catch (error: any) {
    console.error('Failed to fetch and decrypt file from ImageKit:', error);
    throw new Error(error?.message || 'Failed to decrypt file from storage');
  }
}

/**
 * Delete a single file from ImageKit by its fileId.
 *
 * @param fileId - ImageKit unique fileId
 */
export async function deleteFromImageKit(fileId: string): Promise<void> {
  try {
    await imagekit.deleteFile(fileId);
  } catch (error: any) {
    console.error(`Failed to delete file (${fileId}) from ImageKit:`, error);
  }
}

/**
 * Bulk delete multiple files from ImageKit by their fileIds.
 *
 * @param fileIds - Array of ImageKit fileIds
 */
export async function bulkDeleteFromImageKit(fileIds: string[]): Promise<void> {
  if (!fileIds || fileIds.length === 0) return;
  try {
    await imagekit.bulkDeleteFiles(fileIds);
  } catch (error: any) {
    console.error('Failed to bulk delete files from ImageKit:', error);
  }
}

export default imagekit;