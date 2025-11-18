import { getInfoAsync } from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { styles } from './index.styles';

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
  const [qualityPercentage, setQualityPercentage] = useState<string>('80');
  const [targetWidth, setTargetWidth] = useState<string>('');

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

      //resize image
      let resizeAction: ImageManipulator.Action | undefined;
      if (targetWidth.trim()) {
        const width = parseInt(targetWidth.trim(), 10);
        if (width > 0 && width !== originalImage.width) {
          const aspectRatio = originalImage.height / originalImage.width;
          const calculatedHeight = Math.round(width * aspectRatio);
          resizeAction = { resize: { width, height: calculatedHeight } };
        }
      }

      const actions = resizeAction ? [resizeAction] : [];

      // Parse quality percentage (0-100) and convert to quality value (0.0-1.0)
      const rawQuality = Number.parseFloat(qualityPercentage);
      const qualityPct = Number.isFinite(rawQuality) ? Math.max(0, Math.min(100, rawQuality)) : 80;
      const qualityValue = qualityPct / 100;

      // If user chose 100% quality AND no resize requested, avoid recompressing
      if (qualityPct === 100 && !resizeAction) {
        const size = await getFileSize(originalImage.uri);
        setCompressedImage({
          uri: originalImage.uri,
          width: originalImage.width,
          height: originalImage.height,
          size,
        });
        setIsCompressing(false);
        return;
      }

      // Dimensions only change if user provides target width
      const manipResult = await ImageManipulator.manipulateAsync(
        originalImage.uri,
        actions,
        {
          compress: qualityValue, // Quality: 1.0 = best quality, 0.0 = maximum compression
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
        <View style={styles.settingsCard}>
          <Text style={styles.settingsTitle}>Compression Settings</Text>
          
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Quality Percentage (0-100%)</Text>
            <View style={styles.qualityInputContainer}>
              <TextInput
                style={styles.input}
                value={qualityPercentage}
                onChangeText={(text) => {
                  // Allow empty string while typing
                  if (text === '') {
                    setQualityPercentage('');
                    return;
                  }
                  const parsed = parseFloat(text);
                  // Allow 0 as a valid value (0 is falsy, so we check isNaN instead)
                  if (!isNaN(parsed)) {
                    const num = Math.max(0, Math.min(100, parsed));
                    setQualityPercentage(num.toString());
                  }
                }}
                keyboardType="numeric"
                placeholder="80"
                placeholderTextColor="#94a3b8"
              />
              <Text style={styles.percentageText}>%</Text>
            </View>
            <Text style={styles.inputHint}>Higher percentage = better quality (larger file size). Lower percentage = more compression (smaller file size). Dimensions unchanged unless width is specified.</Text>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Target Width (pixels)</Text>
            <TextInput
              style={styles.input}
              value={targetWidth}
              onChangeText={setTargetWidth}
              keyboardType="numeric"
              placeholder={`${originalImage.width} (current)`}
              placeholderTextColor="#94a3b8"
            />
            <Text style={styles.inputHint}>Height will be calculated automatically to maintain aspect ratio</Text>
          </View>
        </View>
      )}

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
