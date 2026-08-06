#!/system/bin/sh
echo "=== ESCANER ESPECIAL PARA SENSOR DE NIVEL LLS (OMNICOMM LLS 19200 / 9600 BAUD) ==="
for dev in /dev/ttyHSL0 /dev/ttyHSL1 /dev/ttyHSL3; do
  for baud in 19200 9600 115200 4800 2400; do
    stty -F $dev $baud raw -echo 2>/dev/null
    for id in 00 01 02 03; do
      # Tramas oficiales Omnicomm LLS (Comando 0x06: Leer Nivel y Temperatura)
      if [ "$id" = "00" ]; then printf '\x31\x00\x06\x6C' > $dev; fi
      if [ "$id" = "01" ]; then printf '\x31\x01\x06\xEF' > $dev; fi
      if [ "$id" = "02" ]; then printf '\x31\x02\x06\x86' > $dev; fi
      
      res=$(timeout 0.8 cat $dev | xxd -p 2>/dev/null)
      if [ -n "$res" ]; then
        echo ">>> ¡¡SENSOR LLS DETECTADO EN $dev A VELOCIDAD $baud BAUDIOS (ID $id)!! <<<"
        echo "RESPUESTA LLS (HEX): $res"
      fi
    done
  done
done
echo "=== FIN DE ESCANEO LLS ==="
