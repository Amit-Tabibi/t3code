import type { AuthClientPresentationMetadata } from "@t3tools/contracts";
import Constants from "expo-constants";
import { Platform } from "react-native";

export function authClientMetadata(): AuthClientPresentationMetadata {
  const appVersion = Constants.expoConfig?.version;
  return {
    label: "T3 Code Mobile",
    deviceType: "mobile",
    ...(Platform.OS === "ios" ? { os: "iOS" } : Platform.OS === "android" ? { os: "Android" } : {}),
    surface: "mobile",
    ...(appVersion ? { appVersion } : {}),
  };
}
