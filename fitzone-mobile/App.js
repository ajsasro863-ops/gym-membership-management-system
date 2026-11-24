import React, { useRef, useState, useEffect } from "react";
import {
    BackHandler,
    Platform,
    StatusBar as RNStatusBar,
    StyleSheet,
    View,
    Text,
    TouchableOpacity,
    ActivityIndicator
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { WebView } from "react-native-webview";

const SERVER_URL = "http://10.62.144.102:3000";

export default function App() {
    const webRef = useRef(null);
    const [canGoBack, setCanGoBack] = useState(false);
    const [error, setError] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);

    // Android back button goes back inside the app
    useEffect(() => {
        if (Platform.OS !== "android") return;

        const sub = BackHandler.addEventListener("hardwareBackPress", () => {
            if (canGoBack && webRef.current) {
                webRef.current.goBack();
                return true;
            }
            return false;
        });

        return () => sub.remove();
    }, [canGoBack]);

    function retry() {
        setError(false);
        setReloadKey(k => k + 1);
    }

    return (
        <View style={styles.container}>
            <StatusBar style="light" />

            {error ? (
                <View style={styles.errorBox}>
                    <Text style={styles.errorTitle}>Can't connect to FitZone</Text>
                    <Text style={styles.errorText}>
                        Make sure the server is running (npm start) and your
                        phone is on the same Wi-Fi as your computer.
                    </Text>
                    <TouchableOpacity style={styles.button} onPress={retry}>
                        <Text style={styles.buttonText}>Try again</Text>
                    </TouchableOpacity>
                </View>
            ) : (
                <WebView
                    key={reloadKey}
                    ref={webRef}
                    source={{ uri: SERVER_URL }}
                    style={styles.web}
                    javaScriptEnabled
                    domStorageEnabled
                    sharedCookiesEnabled
                    thirdPartyCookiesEnabled
                    startInLoadingState
                    renderLoading={() => (
                        <View style={styles.loading}>
                            <ActivityIndicator size="large" color="#ff9f1c" />
                        </View>
                    )}
                    onNavigationStateChange={nav => setCanGoBack(nav.canGoBack)}
                    onError={() => setError(true)}
                    onHttpError={() => setError(true)}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: "#101112",
        paddingTop: Platform.OS === "android" ? RNStatusBar.currentHeight : 48
    },
    web: {
        flex: 1,
        backgroundColor: "#101112"
    },
    loading: {
        ...StyleSheet.absoluteFillObject,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#101112"
    },
    errorBox: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        padding: 30
    },
    errorTitle: {
        color: "white",
        fontSize: 22,
        fontWeight: "700",
        marginBottom: 10
    },
    errorText: {
        color: "#9aa1a9",
        fontSize: 14,
        textAlign: "center",
        lineHeight: 22,
        marginBottom: 24
    },
    button: {
        backgroundColor: "#ff9f1c",
        paddingVertical: 13,
        paddingHorizontal: 28,
        borderRadius: 10
    },
    buttonText: {
        color: "#171717",
        fontWeight: "800",
        fontSize: 15
    }
});