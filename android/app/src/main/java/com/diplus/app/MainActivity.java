package com.diplus.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CanRs485Plugin.class);
        super.onCreate(savedInstanceState);
    }
}

