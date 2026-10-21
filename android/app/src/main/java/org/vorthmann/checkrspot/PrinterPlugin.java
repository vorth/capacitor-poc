package org.vorthmann.checkrspot;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Prints the app's own web view through the system print dialog. Android's
 * WebView ignores {@code window.print()}; its print adapter lays the page out
 * with {@code @media print} styles, so the page decides what appears on paper.
 */
@CapacitorPlugin(name = "Printer")
public class PrinterPlugin extends Plugin {

    @Override
    public void load() {
        // WebView enlarges text below 8px by default; label text is ~4px.
        getBridge().executeOnMainThread(() -> {
            WebSettings settings = getBridge().getWebView().getSettings();
            settings.setMinimumFontSize(1);
            settings.setMinimumLogicalFontSize(1);
        });
    }

    @PluginMethod
    public void printWebView(PluginCall call) {
        String jobName = call.getString("jobName", "Labels");
        getBridge().executeOnMainThread(() -> {
            WebView webView = getBridge().getWebView();
            PrintManager printManager = (PrintManager) getContext().getSystemService(Context.PRINT_SERVICE);
            printManager.print(jobName, webView.createPrintDocumentAdapter(jobName), new PrintAttributes.Builder().build());
            call.resolve();
        });
    }
}
