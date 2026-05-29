param(
    [Parameter(Mandatory=$true)]
    [string]$PdfPath,

    [Parameter(Mandatory=$true)]
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

function Get-Latin1Encoding {
    return [Text.Encoding]::GetEncoding('ISO-8859-1')
}

function Inflate-Bytes {
    param([byte[]]$Data)

    foreach ($skip in 0, 2) {
        try {
            $slice = New-Object byte[] ($Data.Length - $skip)
            [Array]::Copy($Data, $skip, $slice, 0, $slice.Length)
            $ms = New-Object IO.MemoryStream(,$slice)
            $ds = New-Object IO.Compression.DeflateStream($ms, [IO.Compression.CompressionMode]::Decompress)
            $out = New-Object IO.MemoryStream
            $ds.CopyTo($out)
            return $out.ToArray()
        } catch {
        }
    }

    return $Data
}

function Read-PdfObjects {
    param([byte[]]$Bytes)

    $enc = Get-Latin1Encoding
    $pdf = $enc.GetString($Bytes)
    $objects = @{}
    $pattern = '(?ms)^\s*(?<num>\d+)\s+0\s+obj\s*(?<body>.*?)^\s*endobj'

    foreach ($m in [regex]::Matches($pdf, $pattern)) {
        $num = [int]$m.Groups['num'].Value
        $body = $m.Groups['body'].Value
        $streamMatch = [regex]::Match($body, '(?s)^(?<dict>.*?)stream\r?\n')
        $streamText = $null

        if ($streamMatch.Success) {
            $dict = $streamMatch.Groups['dict'].Value
            $lengthMatch = [regex]::Match($dict, '/Length\s+(\d+)')

            if ($lengthMatch.Success) {
                $streamStart = $m.Groups['body'].Index + $streamMatch.Length
                $length = [int]$lengthMatch.Groups[1].Value
                if ($streamStart + $length -le $Bytes.Length) {
                    $data = New-Object byte[] $length
                    [Array]::Copy($Bytes, $streamStart, $data, 0, $length)
                    if ($dict -match '/FlateDecode') {
                        $data = Inflate-Bytes $data
                    }
                    $streamText = $enc.GetString($data)
                }
            }
        }

        $objects[$num] = [pscustomobject]@{
            Number = $num
            Body = $body
            Stream = $streamText
        }
    }

    return $objects
}

function Convert-HexToText {
    param([string]$Hex)

    $hexClean = ($Hex -replace '\s+', '')
    if ($hexClean.Length % 4 -ne 0) {
        return ''
    }

    $chars = New-Object System.Collections.Generic.List[string]
    for ($i = 0; $i -lt $hexClean.Length; $i += 4) {
        $code = [Convert]::ToInt32($hexClean.Substring($i, 4), 16)
        if ($code -ne 0) {
            $chars.Add([char]$code)
        }
    }
    return ($chars -join '')
}

function Parse-ToUnicodeMap {
    param([string]$CMap)

    $map = @{}

    foreach ($line in ($CMap -split "`r?`n")) {
        $trimmed = $line.Trim()

        $range = [regex]::Match($trimmed, '^<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>$')
        if ($range.Success) {
            $start = [Convert]::ToInt32($range.Groups[1].Value, 16)
            $end = [Convert]::ToInt32($range.Groups[2].Value, 16)
            $dst = [Convert]::ToInt32($range.Groups[3].Value, 16)

            for ($code = $start; $code -le $end; $code++) {
                $map[$code] = [char]($dst + ($code - $start))
            }
            continue
        }

        $single = [regex]::Match($trimmed, '^<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>$')
        if ($single.Success) {
            $src = [Convert]::ToInt32($single.Groups[1].Value, 16)
            $map[$src] = Convert-HexToText $single.Groups[2].Value
        }
    }

    return $map
}

function Decode-HexRun {
    param(
        [string]$Hex,
        [hashtable]$Map
    )

    $hexClean = ($Hex -replace '\s+', '')
    $decoded = New-Object System.Text.StringBuilder

    if ($hexClean.Length % 4 -eq 0) {
        for ($i = 0; $i -lt $hexClean.Length; $i += 4) {
            $code = [Convert]::ToInt32($hexClean.Substring($i, 4), 16)
            if ($Map.ContainsKey($code)) {
                [void]$decoded.Append($Map[$code])
            } elseif ($code -ge 32 -and $code -le 126) {
                [void]$decoded.Append([char]$code)
            }
        }
    } elseif ($hexClean.Length % 2 -eq 0) {
        for ($i = 0; $i -lt $hexClean.Length; $i += 2) {
            $code = [Convert]::ToInt32($hexClean.Substring($i, 2), 16)
            if ($Map.ContainsKey($code)) {
                [void]$decoded.Append($Map[$code])
            } elseif ($code -ge 32 -and $code -le 126) {
                [void]$decoded.Append([char]$code)
            }
        }
    }

    return $decoded.ToString()
}

function Parse-LiteralString {
    param(
        [string]$Content,
        [int]$StartIndex
    )

    $sb = New-Object System.Text.StringBuilder
    $depth = 1
    $i = $StartIndex + 1

    while ($i -lt $Content.Length -and $depth -gt 0) {
        $ch = $Content[$i]
        if ($ch -eq '\') {
            if ($i + 1 -lt $Content.Length) {
                $next = $Content[$i + 1]
                switch ($next) {
                    'n' { [void]$sb.Append("`n"); $i += 2; continue }
                    'r' { [void]$sb.Append("`r"); $i += 2; continue }
                    't' { [void]$sb.Append("`t"); $i += 2; continue }
                    'b' { $i += 2; continue }
                    'f' { $i += 2; continue }
                    '(' { [void]$sb.Append('('); $i += 2; continue }
                    ')' { [void]$sb.Append(')'); $i += 2; continue }
                    '\' { [void]$sb.Append('\'); $i += 2; continue }
                    default { [void]$sb.Append($next); $i += 2; continue }
                }
            }
        } elseif ($ch -eq '(') {
            $depth++
            [void]$sb.Append($ch)
        } elseif ($ch -eq ')') {
            $depth--
            if ($depth -gt 0) {
                [void]$sb.Append($ch)
            }
        } else {
            [void]$sb.Append($ch)
        }
        $i++
    }

    return [pscustomobject]@{
        Text = $sb.ToString()
        EndIndex = $i
    }
}

function Decode-LiteralRun {
    param(
        [string]$Value,
        [hashtable]$Map
    )

    $bytes = (Get-Latin1Encoding).GetBytes($Value)
    $decoded = New-Object System.Text.StringBuilder

    if ($bytes.Length % 2 -eq 0) {
        for ($i = 0; $i -lt $bytes.Length; $i += 2) {
            $code = ($bytes[$i] -shl 8) -bor $bytes[$i + 1]
            if ($Map.ContainsKey($code)) {
                [void]$decoded.Append($Map[$code])
            } elseif ($code -ge 32 -and $code -le 126) {
                [void]$decoded.Append([char]$code)
            }
        }
    }

    if ($decoded.Length -eq 0) {
        return $Value
    }
    return $decoded.ToString()
}

function Tokenize-Content {
    param([string]$Content)

    $tokens = New-Object System.Collections.Generic.List[object]
    $i = 0

    while ($i -lt $Content.Length) {
        $ch = $Content[$i]
        if ([char]::IsWhiteSpace($ch)) {
            $i++
            continue
        }

        if ($ch -eq '<' -and $i + 1 -lt $Content.Length -and $Content[$i + 1] -ne '<') {
            $end = $Content.IndexOf('>', $i + 1)
            if ($end -lt 0) { break }
            $tokens.Add([pscustomobject]@{ Type = 'hex'; Value = $Content.Substring($i + 1, $end - $i - 1) })
            $i = $end + 1
            continue
        }

        if ($ch -eq '(') {
            $literal = Parse-LiteralString $Content $i
            $tokens.Add([pscustomobject]@{ Type = 'literal'; Value = $literal.Text })
            $i = $literal.EndIndex
            continue
        }

        if ($ch -eq '/') {
            $j = $i + 1
            while ($j -lt $Content.Length -and -not [char]::IsWhiteSpace($Content[$j]) -and '[]<>(){}'.IndexOf($Content[$j]) -lt 0) {
                $j++
            }
            $tokens.Add([pscustomobject]@{ Type = 'name'; Value = $Content.Substring($i, $j - $i) })
            $i = $j
            continue
        }

        if ('[]{}<>'.IndexOf($ch) -ge 0) {
            $tokens.Add([pscustomobject]@{ Type = 'op'; Value = [string]$ch })
            $i++
            continue
        }

        $j = $i
        while ($j -lt $Content.Length -and -not [char]::IsWhiteSpace($Content[$j]) -and '[]<>(){}'.IndexOf($Content[$j]) -lt 0) {
            $j++
        }
        $tokens.Add([pscustomobject]@{ Type = 'word'; Value = $Content.Substring($i, $j - $i) })
        $i = $j
    }

    return $tokens
}

function Extract-TextFromContent {
    param(
        [string]$Content,
        [hashtable]$FontMaps
    )

    $tokens = Tokenize-Content $Content
    $currentFont = $null
    $text = New-Object System.Text.StringBuilder
    $lastText = $false

    for ($i = 0; $i -lt $tokens.Count; $i++) {
        $token = $tokens[$i]
        $value = $token.Value

        if ($value -eq 'Tf' -and $i -ge 2 -and $tokens[$i - 2].Type -eq 'name') {
            $currentFont = $tokens[$i - 2].Value.Substring(1)
            continue
        }

        if ($value -in @('Tj', "'", '"') -and $i -ge 1) {
            $arg = $tokens[$i - 1]
            $map = @{}
            if ($currentFont -and $FontMaps.ContainsKey($currentFont)) {
                $map = $FontMaps[$currentFont]
            }

            if ($arg.Type -eq 'hex') {
                [void]$text.Append((Decode-HexRun $arg.Value $map))
                $lastText = $true
            } elseif ($arg.Type -eq 'literal') {
                [void]$text.Append((Decode-LiteralRun $arg.Value $map))
                $lastText = $true
            }
            continue
        }

        if ($value -eq 'TJ') {
            $map = @{}
            if ($currentFont -and $FontMaps.ContainsKey($currentFont)) {
                $map = $FontMaps[$currentFont]
            }

            $j = $i - 1
            while ($j -ge 0 -and $tokens[$j].Value -ne '[') {
                $j--
            }
            for ($k = $j + 1; $k -lt $i; $k++) {
                if ($tokens[$k].Type -eq 'hex') {
                    [void]$text.Append((Decode-HexRun $tokens[$k].Value $map))
                } elseif ($tokens[$k].Type -eq 'literal') {
                    [void]$text.Append((Decode-LiteralRun $tokens[$k].Value $map))
                } elseif ($tokens[$k].Type -eq 'word') {
                    $num = 0.0
                    if ([double]::TryParse($tokens[$k].Value, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$num) -and $num -lt -120) {
                        [void]$text.Append(' ')
                    }
                }
            }
            $lastText = $true
            continue
        }

        if ($value -in @('EMC', 'T*') -and $lastText) {
            [void]$text.Append("`n")
            $lastText = $false
            continue
        }
    }

    $raw = $text.ToString()
    $raw = $raw -replace "[`r`n]+", "`n"
    $raw = $raw -replace "[ `t]+", ' '
    $raw = $raw -replace " ?`n ?", "`n"
    return $raw.Trim()
}

function Get-PageObjects {
    param([hashtable]$Objects)

    $pages = New-Object System.Collections.Generic.List[object]
    foreach ($obj in $Objects.Values | Sort-Object Number) {
        if ($obj.Body -match '/Type\s*/Page(\s|/|>>)' -and $obj.Body -notmatch '/Type\s*/Pages') {
            $pages.Add($obj)
        }
    }
    return $pages
}

function Get-PageFontMaps {
    param(
        [object]$Page,
        [hashtable]$Objects
    )

    $fontMaps = @{}
    foreach ($m in [regex]::Matches($Page.Body, '/(?<name>F[^\s/<>\[\]]+)\s+(?<obj>\d+)\s+0\s+R')) {
        $fontName = $m.Groups['name'].Value
        $fontObj = [int]$m.Groups['obj'].Value
        if ($Objects.ContainsKey($fontObj)) {
            $fontBody = $Objects[$fontObj].Body
            $toUnicode = [regex]::Match($fontBody, '/ToUnicode\s+(\d+)\s+0\s+R')
            if ($toUnicode.Success) {
                $mapObj = [int]$toUnicode.Groups[1].Value
                if ($Objects.ContainsKey($mapObj) -and $Objects[$mapObj].Stream) {
                    $fontMaps[$fontName] = Parse-ToUnicodeMap $Objects[$mapObj].Stream
                }
            }
        }
    }
    return $fontMaps
}

function Get-PageContent {
    param(
        [object]$Page,
        [hashtable]$Objects
    )

    $contentObjects = New-Object System.Collections.Generic.List[int]
    $arrayMatch = [regex]::Match($Page.Body, '/Contents\s*\[(?<items>.*?)\]', 'Singleline')
    if ($arrayMatch.Success) {
        foreach ($m in [regex]::Matches($arrayMatch.Groups['items'].Value, '(\d+)\s+0\s+R')) {
            $contentObjects.Add([int]$m.Groups[1].Value)
        }
    } else {
        $single = [regex]::Match($Page.Body, '/Contents\s+(\d+)\s+0\s+R')
        if ($single.Success) {
            $contentObjects.Add([int]$single.Groups[1].Value)
        }
    }

    $parts = New-Object System.Collections.Generic.List[string]
    foreach ($num in $contentObjects) {
        if ($Objects.ContainsKey($num) -and $Objects[$num].Stream) {
            $parts.Add($Objects[$num].Stream)
        }
    }
    return ($parts -join "`n")
}

$resolvedPdf = Resolve-Path $PdfPath
$bytes = [IO.File]::ReadAllBytes($resolvedPdf)
$objects = Read-PdfObjects $bytes
$pages = Get-PageObjects $objects

$out = New-Object System.Text.StringBuilder
$pageNumber = 1
foreach ($page in $pages) {
    $fontMaps = Get-PageFontMaps $page $objects
    $content = Get-PageContent $page $objects
    $pageText = Extract-TextFromContent $content $fontMaps
    [void]$out.AppendLine("===== Page $pageNumber =====")
    [void]$out.AppendLine($pageText)
    [void]$out.AppendLine()
    $pageNumber++
}

$outDir = Split-Path -Parent $OutputPath
if ($outDir) {
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
}
[IO.File]::WriteAllText((Join-Path (Get-Location) $OutputPath), $out.ToString(), [Text.Encoding]::UTF8)
