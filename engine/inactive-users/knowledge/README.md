# Nomes de licenças

`license-names.json` é metadado estático e parcial de produtos, não um inventário de tenant. Revisado em 2026-09-07 com a [referência Microsoft](https://learn.microsoft.com/en-us/entra/identity/users/licensing-service-plan-reference).

Chaves são `skuPartNumber`, nunca service plans. O runtime associa `assignedLicenses.skuId` ao catálogo `/subscribedSkus` e preserva o SKU técnico junto do nome. Sem entrada estática usa o `skuPartNumber` do Graph; sem correspondência de SKU mantém o GUID. Não inferir preços, elegibilidade ou nomes para IDs desconhecidos.
