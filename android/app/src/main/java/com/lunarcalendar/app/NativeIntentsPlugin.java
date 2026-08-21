package com.lunarcalendar.app;

import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Нативный мини-плагин: открывает Activity другой прошивки по строке
 * "package/activity" (deep-link на экраны автозапуска/батареи MIUI, EMUI,
 * ColorOS и т.д.). Если activity не найдена — возвращает ошибку, и JS-код
 * падает назад на текстовую инструкцию.
 */
@CapacitorPlugin(name = "NativeIntents")
public class NativeIntentsPlugin extends Plugin {

    @PluginMethod
    public void openActivity(PluginCall call) {
        String component = call.getString("component");
        if (component == null || !component.contains("/")) {
            call.reject("Invalid component spec, expected 'package/activity'");
            return;
        }

        String[] parts = component.split("/", 2);
        Intent intent = new Intent();
        intent.setComponent(new ComponentName(parts[0], parts[1]));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

        try {
            // Сначала проверяем, что activity вообще существует — иначе
            // ActivityNotFoundException на части прошивок крашит приложение.
            PackageManager pm = getContext().getPackageManager();
            if (pm.resolveActivity(intent, 0) == null) {
                call.reject("Activity not found: " + component);
                return;
            }
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to start activity: " + e.getMessage());
        }
    }
}
