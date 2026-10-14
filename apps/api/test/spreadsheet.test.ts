import { describe, it, expect } from 'vitest';
import { parseSpreadsheetText, parseSpreadsheetBuffer } from '../src/lib/spreadsheet';
import * as XLSX from 'xlsx';

describe('parseSpreadsheet', () => {
  const fullUserCsv = `Afiliados | Magalu (+) AliExpress | 14.10,,,,,,,,,
SKU,ID ALIE,Nome do Item,Preço DE,Cupom Ali,Código Cupom,Preço c/ Cupom,Link,,MINIMUM treshold,discount,code
240247600,1005009891152485,"Smart TV 40"" TCL Full HD QLED 40S5K Google TV 2 HDMI",1562,125,WOBR24,1437,https://pt.aliexpress.com/item/1005009898290246.html,,110,15,WOBR03
238406900,1005007488600554,SMART TV TCL 4K 50P7L,2444,220,WOBR43,2224,https://pt.aliexpress.com/item/1005012492841519.html,,280,35,WOBR07
240146900,1005009626064359,Jogo de Panelas Brinox Revestimento Cerâmico de Alumínio Preto 5 Peças Carbon Ceramic Life,461,35,WOBR07,426,https://pt.aliexpress.com/item/1005007742787013.html,,545,65,WOBR13
240005400,1005008829938272,Fogão Brastemp 5 Bocas Inox com Botôes Removíveis - Bivolt,1795,220,WOBR43,1575,https://pt.aliexpress.com/item/1005007517974090.html,,1025,125,WOBR24
12292300,1005007508654389,"Panela de Pressão Brinox 4,2L Bege Vanilla",174,15,WOBR03,159,https://pt.aliexpress.com/item/1005007533867055.html,,1695,220,WOBR43
241502900,1005012288603843,Lavadora de Roupas Midea 12kg 10 Programas de Lavagem Branco Wave Impeller MAV04W120/WKBR04 - 110V,1799,220,WOBR43,1579,https://pt.aliexpress.com/item/1005010424008060.html,,,,
240708900,1005010424008060,Ar-condicionado Split 12.000 BTUs TCL Inverter Frio BreezeIN AI TAC-12CTG3-INV-I - 220V,2241,220,WOBR43,2021,https://pt.aliexpress.com/item/1005012988671764.html,,,,
241688900,1005012492841519,Lava-louças Electrolux 8 Serviços com Função Higienizar LS08E Inox - 220V,2133,220,WOBR43,1913,https://pt.aliexpress.com/item/1005009626040394.html,,,,
241075800,1005011737451138,Lavadora de Roupas Midea 15kg Cesto Inox 13 Programas de Lavagem Branca Wave Agitator - 110V,1803,220,WOBR43,1583,https://pt.aliexpress.com/item/1005008456457211.html,,,,
240113600,1005009345603253,Forno Elétrico de Embutir Electrolux Multifuncional 80L Preto Experience OE8EA - 220V,1847,220,WOBR43,1627,https://pt.aliexpress.com/item/1005009441311160.html,,,,
240972400,1005011613713263,Lava e Seca TCL 11kg C311WDW Inverter - 110V,2928,220,WOBR43,2708,https://pt.aliexpress.com/item/1005007518124298.html,,,,
`;

  it('extrai todos os 11 produtos com cupom e valores da planilha colada', () => {
    const items = parseSpreadsheetText(fullUserCsv);
    expect(items).toHaveLength(11);

    expect(items[0]).toEqual({
      url: 'https://pt.aliexpress.com/item/1005009898290246.html',
      title: 'Smart TV 40" TCL Full HD QLED 40S5K Google TV 2 HDMI',
      price: 1437,
      originalPrice: 1562,
      discountPct: 8,
      couponCode: 'WOBR24',
    });

    expect(items[5]).toEqual({
      url: 'https://pt.aliexpress.com/item/1005010424008060.html',
      title: 'Lavadora de Roupas Midea 12kg 10 Programas de Lavagem Branco Wave Impeller MAV04W120/WKBR04 - 110V',
      price: 1579,
      originalPrice: 1799,
      discountPct: 12,
      couponCode: 'WOBR43',
    });

    expect(items[10]).toEqual({
      url: 'https://pt.aliexpress.com/item/1005007518124298.html',
      title: 'Lava e Seca TCL 11kg C311WDW Inverter - 110V',
      price: 2708,
      originalPrice: 2928,
      discountPct: 8,
      couponCode: 'WOBR43',
    });
  });

  it('parseia buffer de arquivo .xlsx real', () => {
    const data = [
      ['Afiliados | Magalu (+) AliExpress | 14.10'],
      ['SKU', 'ID ALIE', 'Nome do Item', 'Preço DE', 'Cupom Ali', 'Código Cupom', 'Preço c/ Cupom', 'Link'],
      ['240247600', '1005009891152485', 'Smart TV 40" TCL', 1562, 125, 'WOBR24', 1437, 'https://pt.aliexpress.com/item/1005009898290246.html'],
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Ofertas');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const items = parseSpreadsheetBuffer(buffer);
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe('Smart TV 40" TCL');
    expect(items[0]!.price).toBe(1437);
    expect(items[0]!.originalPrice).toBe(1562);
    expect(items[0]!.couponCode).toBe('WOBR24');
  });
});
