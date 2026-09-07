-- WEC-747: load the real wholesale catalogue from the Meals Management sheet
-- ("2.Meals Management - Menu Fitpal New (8)", exported 2026-09-07).
--
--   sheet column C «B2B» (ΝΑΙ/ΟΧΙ)      -> dish_variants.reseller_available
--   sheet column L «Price B2B (ΦΠΑ)»    -> dish_variants.reseller_price  (cents, VAT incl.)
--   matched on sheet «Κωδικός»          -> dish_variants.external_id
--
-- WHY THIS REPLACES THE WEC-674/648 PREFILL
--
-- That backfill set `reseller_price = price` so no row was null. As a
-- placeholder that was right; as a price it was wrong — every variant cost
-- RETAIL on a reseller storefront. Combined with `reseller_available` being
-- false on 1370 of 1371 rows, the reseller storefront was an empty shop with
-- retail prices on the one thing in it.
--
-- 113 of 1371 variants are sold wholesale, at 48-78% of retail (mean 63%).
--
-- THE RESET IS DELIBERATE
--
-- Rows off the wholesale list get `reseller_price = null`, not a stale copy of
-- retail. `menu-week.ts` and `submit-order.ts` both filter on
-- `reseller_available AND typeof reseller_price === 'number'` with NO fallback
-- to retail (WEC-714), so an unpriced variant is HIDDEN rather than sold at the
-- wrong price. Leaving retail copies behind would mean a future accidental tick
-- of `reseller_available` silently sells at retail; with null it just stays
-- hidden. Fail quiet over fail wrong.
--
-- Verified before applying: all 113 codes matched an existing external_id, and
-- every sheet retail price agreed with dish_variants.price to the cent.

update public.dish_variants
   set reseller_available = false,
       reseller_price     = null;

update public.dish_variants v
   set reseller_available = true,
       reseller_price     = c.b2b_price
  from (values ('29-1',283),('64',486),('65',384),('37',215),('61',463),('49-1',283),('240',418),('3',373),('28',283),('69',576),('227',689),('57',215),('33',215),('26-1',396),('56',407),('317',215),('35',373),('23-1',283),('315',192),('59',158),('39',158),('237',158),('238',158),('236',203),('58',226),('44',192),('40',158),('45',192),('52',192),('53',181),('54',192),('42',158),('239',158),('43',158),('41',192),('281',328),('318',203),('316',181),('67-1',271),('278',373),('63',396),('10',384),('36',328),('25',305),('221',328),('313',237),('314',237),('5-1',407),('6-1',509),('94-1',712),('38-1',316),('7',294),('311',215),('312',215),('20',215),('48',215),('31',215),('254',305),('46',215),('50',215),('34',396),('62-1',350),('1',384),('60',215),('243-1',350),('220-1',350),('287-1',384),('19-1',305),('18-1',305),('285-1',373),('286-1',384),('219-1',373),('235-1',328),('32-1',350),('15',418),('55',350),('27',271),('12',350),('241',373),('24',373),('16',396),('242',350),('2',441),('17',350),('51',316),('66',350),('222',350),('14',463),('13-1',407),('223',328),('4',452),('258',441),('260',362),('319',735),('21-1',350),('8-1',362),('9-1',418),('297',576),('298',554),('299',644),('300',848),('301',791),('302',881),('303',927),('304',633),('305',542),('306',576),('307',599),('308',633),('309',633),('310',633),('47',249),('266-1',350)) as c(code, b2b_price)
 where v.external_id = c.code;
