#import <ImageIO/ImageIO.h>
#import <Foundation/Foundation.h>
#import <Vision/Vision.h>
#import <stdio.h>

static void PrintUsage(const char *programName) {
  fprintf(stderr, "usage: %s <image-path>\n", programName);
}

static void PrintRecognizedText(VNRecognizedTextObservation *observation) {
  VNRecognizedText *candidate = [[observation topCandidates:1] firstObject];
  if (candidate == nil) {
    return;
  }

  NSString *text = candidate.string;
  if (text.length == 0) {
    return;
  }

  NSArray<NSString *> *lines = [text componentsSeparatedByCharactersInSet:[NSCharacterSet newlineCharacterSet]];
  for (NSString *line in lines) {
    if (line.length > 0) {
      printf("%s\n", line.UTF8String);
    }
  }
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 2) {
      PrintUsage(argv[0]);
      return 1;
    }

    NSString *imagePath = [NSString stringWithUTF8String:argv[1]];
    NSURL *imageURL = [NSURL fileURLWithPath:imagePath];
    NSError *readError = nil;
    NSData *imageData = [NSData dataWithContentsOfURL:imageURL options:0 error:&readError];
    if (imageData == nil) {
      fprintf(stderr, "failed to read image: %s\n", readError.localizedDescription.UTF8String);
      return 1;
    }

    CGImageSourceRef source = CGImageSourceCreateWithData((__bridge CFDataRef)imageData, NULL);
    if (source == NULL) {
      fprintf(stderr, "failed to decode image data\n");
      return 1;
    }

    CGImageRef cgImage = CGImageSourceCreateImageAtIndex(source, 0, NULL);
    CFRelease(source);
    if (cgImage == NULL) {
      fprintf(stderr, "failed to load image frame\n");
      return 1;
    }

    VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCGImage:cgImage options:@{}];
    VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc] init];
    request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
    request.recognitionLanguages = @[ @"zh-Hans", @"en-US" ];

    NSError *requestError = nil;
    BOOL success = [handler performRequests:@[ request ] error:&requestError];
    CGImageRelease(cgImage);

    if (!success || requestError != nil) {
      fprintf(stderr, "ocr failed: %s\n", requestError.localizedDescription.UTF8String);
      return 1;
    }

    for (VNRecognizedTextObservation *observation in request.results) {
      PrintRecognizedText(observation);
    }

    return 0;
  }
}
