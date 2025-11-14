import { getInfoAsync } from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

type PickedImage = {
  uri: string;
  width: number;
  height: number;
  size: number;
};

const formatBytes = (bytes: number) => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, exponent)).toFixed(2)} ${units[exponent]}`;
};

const getFileSize = async (uri: string) => {
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    const blob = await response.blob();
    return blob.size;
  }

  const info = await getInfoAsync(uri);
  if (!info.exists || info.isDirectory) {
    throw new Error('File not found');
  }

  return info.size ?? 0;
};

export default function HomeScreen() {
  const [originalImage, setOriginalImage] = useState<PickedImage>();
  const [compressedImage, setCompressedImage] = useState<PickedImage>();
  const [isCompressing, setIsCompressing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const compressionSavings = useMemo(() => {
    if (!originalImage?.size || !compressedImage?.size) return null;
    const diff = originalImage.size - compressedImage.size;
    const pct = diff / originalImage.size;
    return {
      diffText: formatBytes(Math.max(diff, 0)),
      pctText: `${Math.round(Math.max(pct, 0) * 100)}%`,
    };
  }, [originalImage, compressedImage]);

  const downloadImage = async (image: PickedImage, label: string) => {
    try {
      if (Platform.OS === 'web') {
        const response = await fetch(image.uri);
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${label.replace(/\s+/g, '_').toLowerCase()}.jpg`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        return;
      }

      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert('Download unavailable', 'Sharing is not supported on this device.');
        return;
      }

      await Sharing.shareAsync(image.uri, {
        dialogTitle: `Download ${label} image`,
      });
    } catch (e) {
      console.error(e);
      setError('Unable to download image. Please try again.');
    }
  };

  const pickImage = async () => {
    setError(null);
    setCompressedImage(undefined);

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Permission to access media library is required.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
    });

    if (result.canceled) {
      return;
    }

    const asset = result.assets[0];

    try {
      const size = await getFileSize(asset.uri);
      setOriginalImage({
        uri: asset.uri,
        width: asset.width ?? 0,
        height: asset.height ?? 0,
        size,
      });
    } catch {
      setError('Selected file is not a valid image file.');
    }
  };

  const compressImage = async () => {
    if (!originalImage) return;
    setIsCompressing(true);
    setError(null);
    try {
      const manipResult = await ImageManipulator.manipulateAsync(
        originalImage.uri,
        [],
        {
          compress: 0.4,
          format: ImageManipulator.SaveFormat.JPEG,
        }
      );

      const size = await getFileSize(manipResult.uri);

      setCompressedImage({
        uri: manipResult.uri,
        width: manipResult.width ?? originalImage.width,
        height: manipResult.height ?? originalImage.height,
        size,
      });
    } catch (e) {
      console.error(e);
      setError('Failed to compress image. Please try again.');
    } finally {
      setIsCompressing(false);
    }
  };

  const renderPreview = (label: string, data?: PickedImage) => {
    if (!data) return null;
    return (
      <View style={styles.previewCard}>
        <Text style={styles.previewTitle}>{label}</Text>
        <Image source={{ uri: data.uri }} style={styles.previewImage} contentFit="cover" />
        <Text style={styles.metaText}>Dimensions: {data.width} × {data.height}</Text>
        <Text style={styles.metaText}>File size: {formatBytes(data.size)}</Text>
        <Pressable style={styles.downloadButton} onPress={() => downloadImage(data, label)}>
          <Text style={styles.downloadButtonText}>Download</Text>
        </Pressable>
      </View>
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.heading}>Image Compressor</Text>
      <Text style={styles.subheading}>
        Upload an image to quickly generate a compressed version you can download or share.
      </Text>

      <Pressable style={styles.primaryButton} onPress={pickImage}>
        <Text style={styles.primaryButtonText}>{originalImage ? 'Pick another image' : 'Upload image'}</Text>
      </Pressable>

      {originalImage && (
        <Pressable
          style={[styles.secondaryButton, (!originalImage || isCompressing) && styles.buttonDisabled]}
          onPress={compressImage}
          disabled={!originalImage || isCompressing}
        >
          {isCompressing ? <ActivityIndicator color="#1d1d1f" /> : <Text style={styles.secondaryButtonText}>Compress image</Text>}
        </Pressable>
      )}

      {error && <Text style={styles.errorText}>{error}</Text>}

      {renderPreview('Original', originalImage)}
      {renderPreview('Compressed', compressedImage)}

      {compressionSavings && (
        <View style={styles.savingsCard}>
          <Text style={styles.savingsText}>Saved {compressionSavings.diffText} ({compressionSavings.pctText})</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 24,
    backgroundColor: '#f8fafc',
    gap: 16,
  },
  heading: {
    fontSize: 28,
    fontWeight: '700',
    color: '#0f172a',
  },
  subheading: {
    fontSize: 16,
    color: '#475569',
  },
  primaryButton: {
    backgroundColor: '#2563eb',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: '#e2e8f0',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  previewCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  previewTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
    color: '#0f172a',
  },
  previewImage: {
    width: '100%',
    height: 220,
    borderRadius: 12,
    marginBottom: 12,
    backgroundColor: '#cbd5f5',
  },
  metaText: {
    fontSize: 14,
    color: '#475569',
  },
  downloadButton: {
    marginTop: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#cbd5f5',
    backgroundColor: '#eef2ff',
    alignItems: 'center',
  },
  downloadButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1d4ed8',
  },
  savingsCard: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#dcfce7',
    borderWidth: 1,
    borderColor: '#86efac',
  },
  savingsText: {
    fontSize: 16,
    color: '#166534',
    fontWeight: '600',
    textAlign: 'center',
  },
  errorText: {
    color: '#dc2626',
    fontSize: 14,
    fontWeight: '500',
  },
});
