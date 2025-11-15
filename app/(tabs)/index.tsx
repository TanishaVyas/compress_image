import { getInfoAsync } from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, GestureResponderEvent, LayoutChangeEvent, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

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
  const [compressionPercentage, setCompressionPercentage] = useState<string>('40');
  const [targetWidth, setTargetWidth] = useState<string>('');
  const sliderWidth = useRef<number>(0);
  const [sliderLayout, setSliderLayout] = useState({ width: 0, x: 0 });

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

  const handleSliderLayout = (event: LayoutChangeEvent) => {
    const { width, x } = event.nativeEvent.layout;
    sliderWidth.current = width;
    setSliderLayout({ width, x });
  };

  const handleSliderPress = (event: GestureResponderEvent) => {
    if (sliderWidth.current === 0) return;
    const { locationX } = event.nativeEvent;
    const percentage = Math.max(0, Math.min(100, Math.round((locationX / sliderWidth.current) * 100)));
    setCompressionPercentage(percentage.toString());
  };

  const handleSliderPressIn = (event: GestureResponderEvent) => {
    handleSliderPress(event);
  };

  const handleStartShouldSetResponder = () => true;
  const handleMoveShouldSetResponder = () => true;

  const handleSliderMove = (event: GestureResponderEvent) => {
    if (sliderWidth.current === 0) return;
    const touch = event.nativeEvent.touches?.[0];
    if (!touch) return;
    // Calculate relative position within the slider
    const relativeX = touch.pageX - sliderLayout.x;
    const percentage = Math.max(0, Math.min(100, Math.round((relativeX / sliderWidth.current) * 100)));
    setCompressionPercentage(percentage.toString());
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
      // Parse compression percentage (0-100) and convert to quality using a curve that better matches file size reduction
      // JPEG quality doesn't map linearly to file size - we use a non-linear curve
      // 0% compression = 100% quality (1.0), 100% compression = 60% quality (0.6)
      // This curve better approximates file size reduction percentage
      const compressionValue = Math.max(0, Math.min(100, parseFloat(compressionPercentage) || 40)) / 100;
      // Use a curve: quality = 1.0 - (compressionValue^1.2 * 0.4)
      // This provides better correlation between compression % and file size reduction
      const compressionQuality = 1.0 - (Math.pow(compressionValue, 1.2) * 0.4);

      // Only resize if target width is explicitly provided by user
      // Dimensions remain unchanged unless user specifies a width
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

      // Use quality curve (0.6-1.0) that better matches compression percentage to file size reduction
      // Dimensions only change if user explicitly provides target width
      const manipResult = await ImageManipulator.manipulateAsync(
        originalImage.uri,
        actions,
        {
          compress: compressionQuality, // High quality (0.9-1.0) to minimize blur
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
            <Text style={styles.inputLabel}>Compression Percentage (0-100%)</Text>
            <View style={styles.sliderContainer}>
              <View
                style={styles.sliderTrack}
                onLayout={handleSliderLayout}
                onStartShouldSetResponder={handleStartShouldSetResponder}
                onMoveShouldSetResponder={handleMoveShouldSetResponder}
                onResponderGrant={handleSliderPressIn}
                onResponderMove={handleSliderMove}
                onResponderRelease={handleSliderPress}
              >
                <View
                  style={[
                    styles.sliderFill,
                    { width: `${Math.max(0, Math.min(100, parseFloat(compressionPercentage) || 0))}%` },
                  ]}
                />
                <View
                  style={[
                    styles.sliderThumb,
                    { 
                      left: `${Math.max(0, Math.min(100, parseFloat(compressionPercentage) || 0))}%`,
                    },
                  ]}
                />
              </View>
            </View>
            <View style={styles.sliderValueContainer}>
              <TextInput
                style={styles.sliderInput}
                value={compressionPercentage}
                onChangeText={(text) => {
                  const num = Math.max(0, Math.min(100, parseFloat(text) || 0));
                  setCompressionPercentage(num.toString());
                }}
                keyboardType="numeric"
                placeholder="40"
                placeholderTextColor="#94a3b8"
              />
              <Text style={styles.percentageText}>%</Text>
            </View>
            <Text style={styles.inputHint}>Higher percentage = more compression (smaller file size, dimensions unchanged unless width is specified)</Text>
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
  settingsCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
    gap: 16,
  },
  settingsTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#0f172a',
    marginBottom: 4,
  },
  inputGroup: {
    gap: 8,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
  },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#0f172a',
    backgroundColor: '#f8fafc',
  },
  inputHint: {
    fontSize: 12,
    color: '#64748b',
    fontStyle: 'italic',
  },
  sliderContainer: {
    marginVertical: 8,
  },
  sliderTrack: {
    height: 8,
    backgroundColor: '#e2e8f0',
    borderRadius: 4,
    position: 'relative',
    width: '100%',
    paddingVertical: 6, // Increase touch area
    marginVertical: -6, // Compensate for padding
  },
  sliderFill: {
    height: '100%',
    backgroundColor: '#2563eb',
    borderRadius: 4,
    position: 'absolute',
    left: 0,
    top: 0,
  },
  sliderThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#2563eb',
    borderWidth: 2,
    borderColor: '#fff',
    position: 'absolute',
    top: -6,
    marginLeft: -10,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  sliderValueContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  sliderInput: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
    color: '#0f172a',
    backgroundColor: '#f8fafc',
    width: 80,
  },
  percentageText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0f172a',
  },
});
