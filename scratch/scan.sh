#!/system/bin/sh
echo "=== ESCANER AUTOMATICO DE BAUDRATE Y PUERTOS SERIE ==="
for dev in /dev/ttyHSL0 /dev/ttyHSL1 /dev/ttyHSL3; do
  echo "Escaneando puerto $dev..."
  for baud in 2400 4800 9600 14400 19200 38400 57600 115200 230400 250000 460800 500000 921600; do
    stty -F $dev $baud raw -echo 2>/dev/null
    out=$(timeout 1 cat $dev | xxd -p 2>/dev/null)
    if [ -n "$out" ]; then
      echo ">>> ¡EXITO! ENCONTRADO EN $dev A VELOCIDAD $baud BAUDIOS <<<"
      echo "DATOS RAW (HEX): $out"
    fi
  done
done
echo "=== ESCANEO FINALIZADO ==="
