package cloud.socialcircleinfo.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Crear canal de notificaciones (Android 8+)
        createNotificationChannel();

        // Obtener referencia al WebView después de que el Bridge se inicializa
        this.bridge.getWebView().post(() -> {
            webView = (WebView) bridge.getWebView();
        });
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            CharSequence name = "General";
            String description = "Notificaciones de mensajes, grupos y actividad";
            int importance = NotificationManager.IMPORTANCE_HIGH;
            NotificationChannel channel = new NotificationChannel("default", name, importance);
            channel.setDescription(description);
            channel.setShowBadge(true);

            NotificationManager notificationManager = getSystemService(NotificationManager.class);
            if (notificationManager != null) {
                notificationManager.createNotificationChannel(channel);
            }
        }
    }

    @Override
    public void onBackPressed() {
        // Si el WebView tiene historial, navega hacia atrás en lugar de cerrar
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
