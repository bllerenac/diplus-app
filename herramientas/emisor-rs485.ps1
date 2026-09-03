<#
.SYNOPSIS
    Manda tramas de prueba por un puerto serie, para probar la lectura RS485 del
    Edge Computer sin tener el sensor de verdad delante.

.DESCRIPTION
    No hace falta instalar nada. Windows trae System.IO.Ports de .NET, asi que
    esto abre el COM del adaptador USB-RS485 y escribe en el.

    Cada modo emite lo que espera uno de los protocolos que la aplicacion sabe
    leer, para poder comprobarlos por separado:

      json     Una linea de JSON por trama. Es lo que emite el puente del
               HelperBox y el protocolo mas facil de verificar: si la aplicacion
               lo lee, el cable, la velocidad y el troceo por linea van bien.

      csv      Valores separados por punto y coma. En la aplicacion hay que
               poner los nombres de las columnas a mano, porque la trama no los
               trae: caudal,retorno,temperatura,rpm

      modbus   Respuesta Modbus RTU a una lectura de registros, con su CRC bien
               calculado. Prueba de paso que el troceo por silencio funciona.

      todo     Los tres, uno detras de otro, con una pausa entre medias.

.EXAMPLE
    .\emisor-rs485.ps1 -Puerto COM5 -Modo json
    .\emisor-rs485.ps1 -Puerto COM5 -Modo modbus -Baudios 9600 -Cada 2
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $Puerto,

    [ValidateSet('json', 'csv', 'modbus', 'todo')]
    [string] $Modo = 'json',

    [int] $Baudios = 9600,

    # Segundos entre trama y trama.
    [double] $Cada = 1.0,

    # Cuantas mandar. 0 = hasta que se corte con Ctrl+C.
    [int] $Veces = 0,

    # Enciende el transmisor con RTS.
    #
    # Hay dos clases de adaptador USB-RS485: los de direccion automatica, que
    # transmiten solos, y los que usan RTS para habilitar el driver del bus. En
    # .NET RtsEnable viene apagado por defecto, asi que con los segundos no sale
    # nada al cable y parece que el cableado esta mal.
    [switch] $Rts,

    # Igual que el anterior, para los que usan DTR en vez de RTS.
    [switch] $Dtr
)

# ── CRC16 de Modbus RTU ──────────────────────────────────────────────────────
# Polinomio 0xA001. En la trama viaja con el byte bajo primero, que es el error
# clasico al calcularlo a mano.
function Get-Crc16Modbus {
    param([byte[]] $Bytes)

    $crc = 0xFFFF
    foreach ($b in $Bytes) {
        $crc = $crc -bxor $b
        for ($i = 0; $i -lt 8; $i++) {
            if ($crc -band 1) { $crc = ($crc -shr 1) -bxor 0xA001 }
            else { $crc = $crc -shr 1 }
        }
    }
    # Byte bajo primero.
    return [byte[]] @(($crc -band 0xFF), (($crc -shr 8) -band 0xFF))
}

# ── Valores que se mueven, para ver que la pantalla se actualiza ─────────────
# Si fueran fijos no se distinguiria una lectura viva de una pantalla congelada.
$script:paso = 0

function Get-Lectura {
    $script:paso++
    $t = $script:paso

    [pscustomobject] @{
        # Un caudal de ida y otro de retorno: la resta es el consumo, que es la
        # tarjeta de «diferencia» del panel.
        caudal      = [math]::Round(40 + 5 * [math]::Sin($t / 6), 2)
        retorno     = [math]::Round(28 + 4 * [math]::Sin($t / 7), 2)
        temperatura = [math]::Round(78 + 8 * [math]::Sin($t / 11), 1)
        rpm         = [int] (1500 + 400 * [math]::Sin($t / 5))
        nivel       = [math]::Round(160 - ($t % 100), 1)
    }
}

function Get-TramaJson {
    $l = Get-Lectura
    $json = "{""caudal"":$($l.caudal),""retorno"":$($l.retorno),""temperatura"":$($l.temperatura),""rpm"":$($l.rpm),""nivel"":$($l.nivel)}"
    return [System.Text.Encoding]::ASCII.GetBytes($json + "`r`n")
}

function Get-TramaCsv {
    $l = Get-Lectura
    $linea = "$($l.caudal);$($l.retorno);$($l.temperatura);$($l.rpm);$($l.nivel)"
    return [System.Text.Encoding]::ASCII.GetBytes($linea + "`r`n")
}

function Get-TramaModbus {
    # Respuesta de funcion 03 del esclavo 1 con cuatro registros de 16 bits.
    #
    # Van los cuatro multiplicados por 100, para leerlos con escala 0.01 y las
    # columnas  caudal,retorno,temperatura,nivel
    #
    # Las rpm se quedan fuera a proposito: Modbus aplica **una sola escala a
    # todos los registros**, y 1726 rpm entre cien saldrian como 17,26. Mezclar
    # magnitudes de escalas distintas en una misma trama es justo el error que
    # esto tiene que ayudar a encontrar, no a repetir.
    $l = Get-Lectura
    $registros = @(
        [int] ($l.caudal * 100),
        [int] ($l.retorno * 100),
        [int] ($l.temperatura * 100),
        [int] ($l.nivel * 100)
    )

    $cuerpo = New-Object System.Collections.Generic.List[byte]
    $cuerpo.Add(0x01)                       # esclavo
    $cuerpo.Add(0x03)                       # funcion: leer registros
    $cuerpo.Add([byte] ($registros.Count * 2))  # cuantos bytes de datos vienen

    foreach ($r in $registros) {
        $v = [int] $r
        if ($v -lt 0) { $v = 0 }
        if ($v -gt 65535) { $v = 65535 }
        $cuerpo.Add([byte] (($v -shr 8) -band 0xFF))   # Modbus va en big-endian
        $cuerpo.Add([byte] ($v -band 0xFF))
    }

    $bytes = $cuerpo.ToArray()
    return $bytes + (Get-Crc16Modbus -Bytes $bytes)
}

# ── Abrir el puerto ──────────────────────────────────────────────────────────
try {
    $serie = New-Object System.IO.Ports.SerialPort $Puerto, $Baudios, 'None', 8, 'One'
    $serie.WriteTimeout = 2000
    $serie.Handshake = 'None'
    $serie.RtsEnable = [bool] $Rts
    $serie.DtrEnable = [bool] $Dtr
    $serie.Open()
}
catch {
    Write-Host "No se pudo abrir $Puerto a $Baudios baudios." -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ""
    Write-Host "Puertos disponibles:" -ForegroundColor Yellow
    [System.IO.Ports.SerialPort]::GetPortNames() | ForEach-Object { Write-Host "  $_" }
    exit 1
}

Write-Host "Emitiendo por $Puerto a $Baudios baudios, modo '$Modo'." -ForegroundColor Green
Write-Host "Ctrl+C para parar." -ForegroundColor DarkGray
Write-Host ""

$n = 0
try {
    while ($true) {
        $modoAhora = $Modo
        if ($Modo -eq 'todo') {
            $modoAhora = @('json', 'csv', 'modbus')[$n % 3]
        }

        switch ($modoAhora) {
            'json' { $trama = Get-TramaJson }
            'csv' { $trama = Get-TramaCsv }
            'modbus' { $trama = Get-TramaModbus }
        }

        $serie.Write($trama, 0, $trama.Length)
        $n++

        # Se enseña lo que sale, para poder comparar con lo que llega al equipo.
        $comoTexto = if ($modoAhora -eq 'modbus') {
            ($trama | ForEach-Object { $_.ToString('X2') }) -join ' '
        }
        else {
            ([System.Text.Encoding]::ASCII.GetString($trama)).TrimEnd()
        }
        Write-Host ("[{0,4}] {1,-6} {2}" -f $n, $modoAhora, $comoTexto)

        if ($Veces -gt 0 -and $n -ge $Veces) { break }
        Start-Sleep -Milliseconds ([int] ($Cada * 1000))
    }
}
finally {
    if ($serie.IsOpen) { $serie.Close() }
    Write-Host ""
    Write-Host "Puerto cerrado. $n tramas enviadas." -ForegroundColor DarkGray
}
