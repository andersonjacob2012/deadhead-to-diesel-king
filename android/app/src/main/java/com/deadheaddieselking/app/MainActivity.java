package com.deadheaddieselking.app;

import android.os.Bundle;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Android 12+ system splash (navy + DK emblem from AppTheme.NoActionBarLaunch), then postSplashScreenTheme.
        // BridgeActivity does not call this itself (it only setTheme()s AppTheme.NoActionBar), so install it here, before super.onCreate.
        SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);
    }
}
