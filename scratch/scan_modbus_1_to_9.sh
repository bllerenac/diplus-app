#!/system/bin/sh
echo "=== ESCANEO EXTENSIVO MODBUS RTU (ESCLAVOS ID 1 AL 9) ==="

# Función para calcular CRC16 Modbus en shell
calculate_modbus_packet() {
  addr=$1
  fn=$2
  reg_hi=$3
  reg_lo=$4
  len_hi=$5
  len_lo=$6
  
  # Generar PDU y CRC16
}

for dev in /dev/ttyHSL0 /dev/ttyHSL1 /dev/ttyHSL3; do
  for baud in 19200 9600 38400 115200; do
    echo "--- Escaneando $dev a $baud baudios (IDs 1-9) ---"
    stty -F $dev $baud raw -echo 2>/dev/null

    for id in 1 2 3 4 5 6 7 8 9; do
      # 1. Consulta 03 Read Holding (2 registros)
      if [ $id -eq 1 ]; then printf '\x01\x03\x00\x00\x00\x02\xC4\x0B' > $dev; fi
      if [ $id -eq 2 ]; then printf '\x02\x03\x00\x00\x00\x02\xC4\x38' > $dev; fi
      if [ $id -eq 3 ]; then printf '\x03\x03\x00\x00\x00\x02\xC5\xE9' > $dev; fi
      if [ $id -eq 4 ]; then printf '\x04\x03\x00\x00\x00\x02\xC4\x5E' > $dev; fi
      if [ $id -eq 5 ]; then printf '\x05\x03\x00\x00\x00\x02\xC5\x8F' > $dev; fi
      if [ $id -eq 6 ]; then printf '\x06\x03\x00\x00\x00\x02\xC5\xBC' > $dev; fi
      if [ $id -eq 7 ]; then printf '\x07\x03\x00\x00\x00\x02\xC4\x6D' > $dev; fi
      if [ $id -eq 8 ]; then printf '\x08\x03\x00\x00\x00\x02\xC4\x92' > $dev; fi
      if [ $id -eq 9 ]; then printf '\x09\x03\x00\x00\x00\x02\xC5\x43' > $dev; fi

      res=$(timeout 0.6 cat $dev | xxd -p 2>/dev/null)
      if [ -n "$res" ]; then
        echo ">>> ¡¡EXITO MODBUS RECIBIDO EN $dev A $baud BAUDIOS (ESCLAVO ID $id - 2 REGS)!! <<<"
        echo "HEX: $res"
      fi

      # 2. Consulta 03 Read Holding (10 registros)
      if [ $id -eq 1 ]; then printf '\x01\x03\x00\x00\x00\x0A\xC5\xCD' > $dev; fi
      if [ $id -eq 2 ]; then printf '\x02\x03\x00\x00\x00\x0A\xC5\xFE' > $dev; fi
      if [ $id -eq 3 ]; then printf '\x03\x03\x00\x00\x00\x0A\xC4\x2F' > $dev; fi
      if [ $id -eq 4 ]; then printf '\x04\x03\x00\x00\x00\x0A\xC5\x99' > $dev; fi
      if [ $id -eq 5 ]; then printf '\x05\x03\x00\x00\x00\x0A\xC4\x48' > $dev; fi
      if [ $id -eq 6 ]; then printf '\x06\x03\x00\x00\x00\x0A\xC4\x7B' > $dev; fi
      if [ $id -eq 7 ]; then printf '\x07\x03\x00\x00\x00\x0A\xC5\xAA' > $dev; fi
      if [ $id -eq 8 ]; then printf '\x08\x03\x00\x00\x00\x0A\xC5\x55' > $dev; fi
      if [ $id -eq 9 ]; then printf '\x09\x03\x00\x00\x00\x0A\xC4\x84' > $dev; fi

      res10=$(timeout 0.6 cat $dev | xxd -p 2>/dev/null)
      if [ -n "$res10" ]; then
        echo ">>> ¡¡EXITO MODBUS RECIBIDO EN $dev A $baud BAUDIOS (ESCLAVO ID $id - 10 REGS)!! <<<"
        echo "HEX: $res10"
      fi
    done
  done
done
echo "=== FIN DE ESCANEO MODBUS ID 1-9 ==="
