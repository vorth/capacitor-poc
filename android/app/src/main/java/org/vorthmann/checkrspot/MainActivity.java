package org.vorthmann.checkrspot;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PrinterPlugin.class);
        registerPlugin(FileSaverPlugin.class);
        registerPlugin(PhotoImportPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
