package cloud.socialcircleinfo.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {

    private WebView webView;
    private PermissionRequest pendingPermissionRequest;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Crear canal de notificaciones (Android 8+)
        createNotificationChannel();

        // Obtener referencia al WebView después de que el Bridge se inicializa
        this.bridge.getWebView().post(() -> {
            webView = (WebView) bridge.getWebView();
            enforceWebViewPermissions();
        });
    }

    /**
     * Asegura que el WebView pida permisos de micrófono/cámara correctamente.
     * En Android 6+, el callback onPermissionRequest del WebView necesita
     * emparejarse con ActivityCompat.requestPermissions para RECORD_AUDIO.
     * Sin esto, getUserMedia({audio:true}) falla silenciosamente.
     */
    private void enforceWebViewPermissions() {
        if (webView == null) return;

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
                    // Android < 6: permisos ya concedidos en install
                    request.grant(request.getResources());
                    return;
                }

                List<String> androidPerms = new ArrayList<>();
                for (String resource : request.getResources()) {
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                        androidPerms.add(Manifest.permission.RECORD_AUDIO);
                    } else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) {
                        androidPerms.add(Manifest.permission.CAMERA);
                    }
                }

                if (androidPerms.isEmpty()) {
                    request.grant(request.getResources());
                    return;
                }

                // Solo pedir los permisos que aún no tenemos
                List<String> needed = new ArrayList<>();
                for (String perm : androidPerms) {
                    if (ContextCompat.checkSelfPermission(MainActivity.this, perm)
                            != PackageManager.PERMISSION_GRANTED) {
                        needed.add(perm);
                    }
                }

                if (needed.isEmpty()) {
                    // Ya concedidos — conceder el request del WebView
                    request.grant(request.getResources());
                } else {
                    // Guardar request pendiente y pedir al usuario
                    pendingPermissionRequest = request;
                    ActivityCompat.requestPermissions(
                        MainActivity.this,
                        needed.toArray(new String[0]),
                        1001
                    );
                }
            }
        });
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);

        if (requestCode == 1001 && pendingPermissionRequest != null) {
            boolean allGranted = grantResults.length > 0;
            for (int result : grantResults) {
                if (result != PackageManager.PERMISSION_GRANTED) {
                    allGranted = false;
                    break;
                }
            }

            if (allGranted) {
                pendingPermissionRequest.grant(pendingPermissionRequest.getResources());
            } else {
                pendingPermissionRequest.deny();
            }
            pendingPermissionRequest = null;
        }
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
