#!/system/bin/sh
echo "=== PRUEBA DE TRANSMISION CAN1 A CAN2 (SENAL FICTICIA) ==="

stty -F /dev/ttyHSL3 115200 raw -echo 2>/dev/null
stty -F /dev/ttyHSL1 115200 raw -echo 2>/dev/null

echo "Mando tramas CAN ficticias por /dev/ttyHSL3 (CAN1)..."
(
  for i in 1 2 3 4 5; do
    printf '\x41\x2A\x80\x1F\x00\x08\x18\xFE' > /dev/ttyHSL3
    sleep 0.5
  done
) &

echo "Escuchando en /dev/ttyHSL1 (CAN2)..."
res=$(timeout 3 cat /dev/ttyHSL1 | xxd -p 2>/dev/null)

if [ -n "$res" ]; then
  echo ">>> ¡¡ÉXITO TOTAL!! SEÑAL FICTICIA CAN RECIBIDA EN CAN2: $res"
else
  echo "Sin recepción en CAN2 (Asegúrate de unir CAN1_H con CAN2_H y CAN1_L con CAN2_L)"
fi
echo "=== FIN ==="
